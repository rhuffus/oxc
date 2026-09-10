# `nestjs/class-methods-use-this`

Introducida en `1.82.0-nestjs.3` del fork de rhuffus. Regla nativa en Rust de la categoría `restriction`, desactivada por defecto, sin análisis de tipos ni autofix. Conserva la comprobación y las cuatro opciones de `eslint/class-methods-use-this`, con una excepción para métodos de instancia ordinarios decorados como handlers HTTP de NestJS cuyo nombre estático sea conocido y distinto de `constructor`.

## Qué comprueba

Un handler HTTP puede devolver una respuesta sin acceder a `this`: NestJS necesita que sea un método de instancia para descubrirlo como ruta. Esta regla permite ese caso y sigue comprobando los demás miembros con la implementación de upstream. La excepción se aplica al método decorado, no a toda la clase ni a todos sus métodos decorados.

Este controlador no produce un diagnóstico de esta regla:

```ts
import { Controller, Get } from "@nestjs/common";

@Controller()
export class StatusController {
  @Get("status")
  status(): string {
    return "ready";
  }
}
```

Un método auxiliar sin `this` sigue produciendo un diagnóstico, aunque pertenezca al mismo controlador:

```ts
import { Controller, Get } from "@nestjs/common";

@Controller()
export class StatusController {
  @Get("status")
  status(): string {
    return "ready";
  }

  normalize(value: string): string {
    return value.trim(); // Diagnóstico en el nombre de normalize.
  }
}
```

Fuera de la excepción HTTP, se conserva la semántica de upstream: los constructores y miembros estáticos no necesitan `this`; las firmas sin cuerpo no se comprueban; `super` también satisface la regla. El uso de `this` en una función flecha anidada cuenta, pero el de una función ordinaria anidada pertenece a otro contexto y no satisface al método exterior. La regla comprueba presencia de `this`, no si la dependencia de la instancia es necesaria para el diseño.

## Configuración y combinación de reglas

Al sustituir la regla base, desactiva `class-methods-use-this` y activa `nestjs/class-methods-use-this` con las mismas opciones. Si ambas permanecen activas, la base seguirá denunciando los handlers válidos sin `this` y los miembros ordinarios podrán recibir diagnósticos duplicados. En las claves de configuración de Oxlint, `class-methods-use-this` identifica la regla base de ESLint.

Este ejemplo ejecuta exclusivamente las dos reglas de NestJS y muestra las cuatro opciones heredadas con sus valores predeterminados. Las categorías se desactivan para que no habiliten otras reglas; en un proyecto con una política existente, conserva sus plugins y categorías y modifica solo las entradas necesarias:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["nestjs"],
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  rules: {
    "class-methods-use-this": "off",
    "nestjs/class-methods-use-this": [
      "error",
      {
        enforceForClassFields: true,
        exceptMethods: [],
        ignoreClassesWithImplements: undefined,
        ignoreOverrideMethods: false,
      },
    ],
    "nestjs/no-static-handlers": "error",
  },
});
```

Cada regla se activa por separado. `nestjs/class-methods-use-this` permite que un handler de instancia no use `this`; no prohíbe convertirlo en estático, porque upstream omite los miembros estáticos. [`nestjs/no-static-handlers`](no-static-handlers.md) detecta ese segundo caso. Activar una no activa implícitamente la otra. Activar solo el plugin tampoco equivale a seleccionar exclusivamente estas reglas: las categorías y las entradas `rules` determinan cuáles se ejecutan.

## Opciones heredadas

Todas las propiedades son opcionales y pertenecen a un único objeto de opciones. No hay opciones adicionales para NestJS. Puedes usar solo `"error"` para aceptar los valores predeterminados o la tupla `['error', { ... }]` para configurarlas.

| Propiedad                     | Valores admitidos                     | Predeterminado | Efecto                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforceForClassFields`       | `true`, `false`                       | `true`         | Comprueba campos de instancia y propiedades `accessor` cuyo inicializador es una función ordinaria o flecha. `false` omite ambos tipos de miembro; no omite métodos ordinarios, getters ni setters.                                                 |
| `exceptMethods`               | Array de cadenas                      | `[]`           | Omite miembros cuyo nombre coincide exactamente. Por ejemplo, `"normalize"` para un nombre ordinario y `"#normalize"` para un privado de JavaScript; esos dos nombres no son intercambiables. No interpreta expresiones regulares ni patrones glob. |
| `ignoreClassesWithImplements` | `"all"`, `"public-fields"`, u omisión | Omitido        | `"all"` omite los miembros comprobados de clases con `implements`; `"public-fields"` omite solo los públicos, incluidos métodos, getters, setters y campos. No se limita a los miembros realmente declarados en la interfaz.                        |
| `ignoreOverrideMethods`       | `true`, `false`                       | `false`        | Omite miembros marcados explícitamente con `override`; incluye métodos, getters, setters y campos que la regla comprobaría. No deduce sobrescrituras que no lleven ese modificador.                                                                 |

En `oxlint.config.ts`, `ignoreClassesWithImplements: undefined` mantiene visible la opción y se omite al serializarla. En JSON, omite esa propiedad para conservar el mismo comportamiento. El `default: null` de los metadatos heredados representa ausencia; `null` no es una alternativa del enum admitido por el esquema y los tipos de configuración.

Estas opciones siguen siendo excepciones explícitas de la regla base. La excepción automática de NestJS se limita a handlers HTTP ordinarios; no introduce una exención general para clases `@Controller`, clases `@Injectable`, servicios, hooks de ciclo de vida ni métodos que implementan una interfaz.

## Decoradores e identidad de los imports

Las dos reglas de NestJS comparten el mismo reconocimiento de los 19 decoradores HTTP: `RequestMapping`, `Get`, `Post`, `Delete`, `Put`, `Patch`, `Options`, `Head`, `All`, `Search`, `QueryMethod`, `Propfind`, `Proppatch`, `Mkcol`, `Copy`, `Move`, `Lock`, `Unlock` y `Sse`. `QueryMethod` declara un handler HTTP QUERY; `Query` es un decorador de parámetros y no concede la excepción. El [catálogo y sus fuentes de NestJS 12.0.1](no-static-handlers.md#decoradores-reconocidos) detallan esta distinción.

Se reconocen llamadas a imports con nombre, alias y namespaces de `@nestjs/common`, como `@Get()`, `@Route()` tras `import { Get as Route }`, `@Nest.Get()` y `@(Nest["Get"]())`. También se admiten claves de plantilla sin interpolación y paréntesis. Se resuelve el símbolo de cada identificador: un parámetro o una declaración local que oculta el import no obtiene una excepción por llamarse `Get` o `Nest`. Los imports `type` y los imports de otros módulos tampoco la obtienen.

No es necesario que la clase lleve `@Controller`: también se reconoce un handler declarado en una clase base o en una expresión de clase. La comprobación se aplica a cada declaración; no copia los decoradores de un método heredado a un método que lo sobrescribe.

## Límites de la excepción

- Solo se exceptúan métodos de instancia ordinarios con una llamada a una factory HTTP reconocida y un nombre estático conocido distinto de `constructor`. Se admiten identificadores como `status` y nombres literales, incluidos nombres calculados estáticamente como `['status']` o una plantilla sin interpolación.
- Las claves Symbol y los nombres calculados dinámicamente no reciben la excepción, aunque el decorador HTTP sea reconocido. Tampoco la recibe `['constructor']`: NestJS omite ese nombre al recorrer el prototipo. Estos métodos siguen la comprobación de `this` y las opciones heredadas de upstream.
- Los métodos privados de JavaScript `#handler`, getters, setters, campos de función y propiedades `accessor` siguen la política de upstream aunque lleven un decorador HTTP; las opciones heredadas pueden omitirlos por sus propios criterios.
- Decoradores como `UseGuards`, `HttpCode`, `Header`, `Redirect`, `Render`, `Injectable` o `Controller` no conceden la excepción por sí solos. Los handlers de WebSocket, microservicios, tareas programadas y eventos quedan fuera de este catálogo HTTP.
- No se siguen reexports, imports de subrutas, imports por defecto, `require()` ni `import = require()`. Tampoco alias por asignación como `const Route = Get` o `const Alias = Nest`.
- No se interpretan decoradores compuestos mediante `applyDecorators` o wrappers propios, claves de namespace dinámicas ni factories usadas sin invocación, como `@Get`.
- No se comprueba que la clase esté registrada en un módulo, que el decorador sea válido para ese tipo de miembro o que la aplicación llegue a exponer una ruta. La ausencia de diagnóstico no certifica esas condiciones.

El nombre debe estar disponible directamente en la sintaxis del miembro. Por ejemplo, `@Get() ['status']() {}` recibe la excepción, pero `@Get() [routeName]() {}` no la recibe aunque una constante local asigne `"status"` a `routeName`. Tampoco se resuelven claves como `[Symbol.iterator]` ni plantillas con interpolaciones. Esta selección conservadora delimita la excepción; no añade un diagnóstico específico sobre nombres de rutas ni valida el descubrimiento HTTP.

Un método privado de JavaScript como `#handler` no queda expuesto como propiedad nombrada del prototipo y no recibe la excepción HTTP. En cambio, los modificadores TypeScript `private` y `protected` conservan el método en el prototipo tras compilarse: un método ordinario `private handler()` o `protected handler()` con un decorador HTTP reconocido sí recibe la excepción. Esta diferencia depende del tipo de miembro, no de la cadena elegida para su nombre.

Un getter o setter con decoradores HTTP no se convierte en un handler ordinario por pasar una comprobación de `this`. NestJS excluye esos descriptores del descubrimiento de rutas; deben revisarse como métodos de instancia ordinarios. Véase la [explicación y la fuente de `MetadataScanner`](no-static-handlers.md#getters-setters-y-corrección-manual).

## Diagnósticos, corrección y mantenimiento

No hay autofix ni sugerencias que editen código. Para los miembros que continúan comprobándose se conserva el diagnóstico de upstream, incluida su recomendación de considerar un método estático. La decisión debe revisar las llamadas existentes y el contrato de la instancia; no es necesario introducir un uso artificial de `this` en un handler HTTP reconocido.

La implementación reutiliza [`eslint/class_methods_use_this.rs`](https://github.com/rhuffus/oxc/blob/codex/nestjs/crates/oxc_linter/src/rules/eslint/class_methods_use_this.rs) para las opciones y la comprobación general; el filtro de NestJS está en [`nestjs/class_methods_use_this.rs`](https://github.com/rhuffus/oxc/blob/codex/nestjs/crates/oxc_linter/src/rules/nestjs/class_methods_use_this.rs). Al actualizar upstream deben revisarse sus opciones, defaults y cambios de comportamiento junto con las pruebas de ambas reglas.

Desde la raíz del fork, las pruebas nativas de NestJS se ejecutan con:

```sh
cargo test -p oxc_linter nestjs
```
