# `nestjs/no-static-handlers`

Introducida en `1.82.0-nestjs.2` del fork de rhuffus. Regla nativa en Rust de la categoría `correctness`, desactivada por defecto, sin opciones, análisis de tipos ni autofix.

## Qué detecta

Detecta métodos estáticos decorados como handlers HTTP mediante imports de `@nestjs/common`. NestJS descubre las rutas recorriendo el prototipo de la instancia del controlador y sus clases base. Un método estático pertenece al constructor de la clase y no se registra mediante ese descubrimiento normal, aunque una llamada directa al método funcione. Véase [`PathsExplorer` en NestJS 12.0.1](https://github.com/nestjs/nest/blob/v12.0.1/packages/core/router/paths-explorer.ts).

Ejemplo con diagnóstico:

```ts
import { Controller, Get } from "@nestjs/common";

@Controller()
export class StatusController {
  @Get("status")
  static status(): string {
    return "ready";
  }
}
```

El handler debe ser un método de instancia. Este ejemplo no produce un diagnóstico de esta regla:

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

El cuerpo no tiene que usar `this` ni acceder a un servicio. La comprobación se centra en el carácter estático del método; tampoco prohíbe métodos auxiliares estáticos sin un decorador HTTP reconocido.

## Configuración

Activa el plugin `nestjs` y la regla explícitamente. Este `oxlint.config.ts` conserva los plugins predeterminados de upstream; si el proyecto ya define otros, añade `nestjs` a su lista existente:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "nestjs"],
  rules: {
    "nestjs/no-static-handlers": "error",
  },
});
```

La regla no acepta parámetros de configuración. Por ejemplo, `["error", {}]` no forma parte de su esquema. No requiere `--type-aware` ni `oxlint-tsgolint`.

## Decoradores reconocidos

El catálogo comprende las 18 factories de [`request-mapping.decorator.ts`](https://github.com/nestjs/nest/blob/v12.0.1/packages/common/decorators/http/request-mapping.decorator.ts) y [`Sse`](https://github.com/nestjs/nest/blob/v12.0.1/packages/common/decorators/http/sse.decorator.ts), para un total de 19 decoradores de NestJS 12.0.1:

| Grupo              | Decoradores                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Asignación general | `RequestMapping`                                                                           |
| HTTP               | `Get`, `Post`, `Delete`, `Put`, `Patch`, `Options`, `Head`, `All`, `Search`, `QueryMethod` |
| WebDAV             | `Propfind`, `Proppatch`, `Mkcol`, `Copy`, `Move`, `Lock`, `Unlock`                         |
| Eventos HTTP       | `Sse`                                                                                      |

`QueryMethod` declara un handler del método HTTP QUERY; `Query` es un decorador de parámetros y queda fuera de este catálogo. Decoradores como `HttpCode`, `Header`, `Redirect`, `Render` o `UseGuards` no activan esta regla por sí solos.

## Imports y alcance de los símbolos

La regla resuelve cada identificador hasta su declaración de importación. Reconoce imports con nombre, alias y namespaces procedentes exactamente de `@nestjs/common`:

```ts
import { Get as Route } from "@nestjs/common";
import * as Nest from "@nestjs/common";

class BaseController {
  @Route()
  static aliased() {}

  @Nest.Get()
  static namespace() {}

  @(Nest["Get"]())
  static computed() {}

  @(Nest[`Get`]())
  static template() {}
}
```

Los cuatro métodos anteriores se denuncian. Las propiedades calculadas deben ser cadenas literales o plantillas sin interpolaciones. Se admiten paréntesis alrededor de las expresiones.

Un identificador local o un parámetro de una función que crea la clase puede ocultar el import; en ese caso el decorador no se atribuye a NestJS. Un parámetro dentro del propio handler no oculta el import utilizado por el decorador, que se evalúa fuera del cuerpo del método. También se descartan imports `type`, tanto a nivel de declaración como de especificador, e imports de otros módulos.

No se exige `@Controller` en la misma clase: también se comprueban métodos declarados en clases base, expresiones de clase y mixins. Cuando un método tiene varios decoradores HTTP reconocidos se emite un único diagnóstico, señalado en el nombre del método.

## Getters, setters y corrección manual

Los getters y setters estáticos con decoradores HTTP también se denuncian. Deben convertirse en métodos de instancia ordinarios: quitar solamente `static` no basta. El [`MetadataScanner` de NestJS 12.0.1](https://github.com/nestjs/nest/blob/v12.0.1/packages/core/metadata-scanner.ts) excluye getters y setters al descubrir handlers.

No hay autofix ni sugerencias que modifiquen código. Al convertir un miembro estático en un método de instancia puede ser necesario cambiar llamadas como `StatusController.status()` y revisar quién obtiene la instancia. La corrección debe comprobarse mediante peticiones HTTP reales, además de las llamadas directas utilizadas en tests.

## Límites deliberados

- Solo se reconocen llamadas a las factories del catálogo. Un uso sin invocación, como `@Get`, no se analiza como factory HTTP.
- No se siguen reexports, imports de subrutas, imports por defecto, `require()` ni `import = require()`.
- No se siguen asignaciones como `const Route = Get` o `const Alias = Nest`, ni decoradores propios construidos mediante `applyDecorators` u otros wrappers.
- No se evalúan propiedades dinámicas, aunque procedan de `const key = "Get"`, ni plantillas con interpolaciones. Tampoco se siguen miembros anidados como `Nest.http.Get`.
- Los campos de clase, incluidas funciones flecha, y los miembros declarados con la palabra `accessor` quedan fuera del alcance. La regla tampoco valida los targets de decoradores no estáticos, incluidos getters y setters de instancia.
- No se analizan handlers de GraphQL, WebSockets o microservicios, ni se comprueba que la clase esté registrada en un módulo NestJS.

La ausencia de un diagnóstico en estos casos no certifica que el código sea válido para NestJS.

## Interacción con `class-methods-use-this`

Un handler de instancia sin `this`, como el ejemplo `status()`, es válido para esta regla. Desde `1.82.0-nestjs.3`, [`nestjs/class-methods-use-this`](class-methods-use-this.md) resuelve la interacción con la regla de upstream: permite ese método HTTP y conserva la comprobación de los demás miembros. Desactiva `class-methods-use-this`, activa `nestjs/class-methods-use-this` con las mismas opciones y mantén `nestjs/no-static-handlers` activa para detectar handlers estáticos. Las dos reglas comparten el catálogo HTTP y se activan por separado; ninguna modifica ni desactiva automáticamente la regla base. Los auxiliares siguen comprobándose y getters, setters, campos de función y propiedades `accessor` no reciben la excepción HTTP.

## Comprobaciones del fork

Las pruebas nativas cubren 160 casos: 61 sin diagnóstico y 99 con diagnóstico, incluidos los 19 decoradores, varias formas de import, el ocultamiento de símbolos, getters/setters y los límites anteriores. Desde la raíz del fork:

```sh
cargo test -p oxc_linter no_static_handlers
```

El harness de integración utiliza el CLI compilado y las dependencias ya instaladas del demo. Comprueba catálogo, esquema, declaraciones TypeScript, diagnósticos, enlaces de documentación y ausencia de cambios en los modos de fix; además arranca una aplicación NestJS real en un puerto efímero para contrastar HTTP 200 en el método de instancia y HTTP 404 en el estático:

```sh
node forks/nestjs/test-http-handlers.mjs \
  --cli apps/oxlint/dist/cli.js \
  --demo-dir ../polaris/experiments/nestjs-demo
```

El harness no instala dependencias ni modifica el demo. Cierra el servidor y elimina su consumidor temporal al terminar. La implementación de la regla está en [`no_static_handlers.rs`](https://github.com/rhuffus/oxc/blob/codex/nestjs/crates/oxc_linter/src/rules/nestjs/no_static_handlers.rs).
