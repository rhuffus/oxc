# Oxlint para NestJS — fork de rhuffus

Este fork de [Oxc](https://github.com/oxc-project/oxc) incorpora validaciones de NestJS integradas en Rust. Desde `1.82.0-nestjs.2` incluye [`nestjs/no-static-handlers`](rules/no-static-handlers.md), que detecta métodos estáticos decorados como handlers HTTP. Desde `1.82.0-nestjs.3`, [`nestjs/class-methods-use-this`](rules/class-methods-use-this.md) permite que esos handlers sean métodos de instancia sin usar `this`, conservando la comprobación y las opciones de upstream para los demás miembros. La versión `1.82.0-nestjs.1` preparó la compilación y distribución; la base de upstream sigue siendo el tag oficial `oxlint_v1.82.0`.

La rama de trabajo es `codex/nestjs`. La rama `main` se conserva para seguir upstream. Los scripts y la documentación del fork viven en `forks/nestjs/`; sus reglas nativas están en `crates/oxc_linter/src/rules/nestjs/`.

## Activar las reglas HTTP

El plugin `nestjs` se activa explícitamente. Este ejemplo de `oxlint.config.ts` conserva los plugins predeterminados de upstream, activa las dos reglas con severidad `error` y desactiva la regla base que sustituye la variante de NestJS. Si ya tienes una lista de plugins, añade `nestjs` a esa lista y conserva las opciones que tuviera `class-methods-use-this` al trasladarlas a `nestjs/class-methods-use-this`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "nestjs"],
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

`nestjs/no-static-handlers` pertenece a `correctness` y no admite opciones. `nestjs/class-methods-use-this` pertenece a `restriction` y hereda las cuatro opciones de la regla base. Ambas usan el mismo catálogo de 19 decoradores HTTP de NestJS 12, reconocen imports con alias y namespaces, respetan el símbolo de cada identificador y comprueban clases base sin `@Controller`. No requieren análisis de tipos ni ofrecen autofix. Sus documentos explican los [handlers estáticos](rules/no-static-handlers.md) y la [excepción para métodos de instancia](rules/class-methods-use-this.md), con ejemplos y límites.

Desde `1.82.0-nestjs.3`, esta combinación resuelve el conflicto entre exigir `this` y mantener un handler de instancia: la variante NestJS exceptúa únicamente el método HTTP ordinario y sigue comprobando sus auxiliares. Getters, setters, campos de función y propiedades `accessor` no reciben esa excepción. La base debe permanecer en `off` para evitar sus diagnósticos y duplicidades. Cada regla se activa por separado; las categorías de la configuración también pueden activar otras reglas. La [configuración aislada de ejemplo](rules/class-methods-use-this.md#configuración-y-combinación-de-reglas) muestra cómo ejecutar exclusivamente estas dos.

## Instalar un build

Cada publicación del workflow **Release NestJS fork** adjunta a una GitHub Release un paquete npm `.tgz`, `checksums.txt` y `build-info.json`. Desde el proyecto consumidor, sustituye `REVISION` por la revisión publicada:

```sh
pnpm add -D 'oxlint@https://github.com/rhuffus/oxc/releases/download/oxlint-v1.82.0-nestjs.REVISION/oxlint-1.82.0-nestjs.REVISION.tgz'
pnpm exec oxlint --version
node -p 'require("oxlint/package.json").version'
```

El paquete se instala como `oxlint`, conservando el comando y `import { defineConfig } from 'oxlint'`. `oxlint --version` muestra la versión base de upstream; la revisión del fork aparece en `oxlint/package.json` y su commit en `build-info.json`. El lockfile del proyecto consumidor fija la URL y la integridad del tarball.

Este paquete requiere macOS y Node.js ejecutado como `arm64`, además de la versión mínima de Node declarada por Oxlint. Incluye el módulo nativo compilado en el fork: no requiere Rust en el equipo consumidor ni scripts de instalación. Si falta o falla ese módulo, el comando falla sin buscar bindings oficiales. Conserva las dependencias peer opcionales de upstream; `oxlint-tsgolint`, necesario para el análisis de tipos, se instala aparte cuando se utilice esa función.

Usa el tarball de la Release, no `github:rhuffus/oxc`: esa referencia apunta al monorepo fuente. Los artifacts de Actions sirven para descargar y revisar un build, pero la URL pública del `.tgz` de una Release es la que se utiliza con pnpm.

## Compilar y publicar

En GitHub, abre **Actions → Release NestJS fork → Run workflow**, selecciona `codex/nestjs` e indica una revisión entera positiva. Con `publish` desactivado se compila, verifica y guarda el paquete como artifact. Con `publish` activado, después de superar las comprobaciones, también se crea una prerelease y un tag `oxlint-vVERSION`. Incrementa la revisión para cada publicación: el workflow no sobrescribe Releases existentes.

El build usa el Rust fijado en `rust-toolchain.toml`, pnpm fijado en `package.json`, los lockfiles del repositorio y el target `aarch64-apple-darwin`. Compila el binding nativo en modo release con el allocator oficial, construye el wrapper JavaScript y conserva el CLI, esquema de configuración, declaraciones TypeScript y `oxlint/plugins-dev`. Los metadatos registran el commit y las versiones efectivas de las herramientas.

Antes de compilar, el workflow ejecuta las suites nativas del linter, del CLI y del generador de reglas. Después instala el tarball en un proyecto temporal y prueba el CLI, la configuración TypeScript, un plugin JavaScript, los exports y la identidad del módulo nativo. Esa prueba también exige que la regla HTTP detecte un handler estático, acepte un handler de instancia y un auxiliar estático, y no modifique código con `--fix`, sin instalar NestJS en el consumidor. No se publica en el registro npm. GitHub Actions usa su `GITHUB_TOKEN` para adjuntar los archivos al propio fork.

Para reproducirlo localmente en Apple Silicon, desde la raíz del fork:

```sh
pnpm install --frozen-lockfile
node forks/nestjs/build-package.mjs 3
node forks/nestjs/smoke-package.mjs target/nestjs-release/oxlint-1.82.0-nestjs.3.tgz apps/oxlint/src-js/oxlint.darwin-arm64.node
```

Los archivos de salida están en `target/nestjs-release/`. El empaquetador restaura los cargadores fuente después de generar el bundle específico de esta plataforma. Las futuras actualizaciones de upstream deben revisar el empaquetado y repetir estas pruebas. Añadir otras plataformas requerirá builds y paquetes específicos.

## Verificar las reglas

Las pruebas nativas comprueban el reconocimiento y las exclusiones de los decoradores, la política de los miembros ordinarios y las opciones heredadas. `no-static-handlers` conserva sus 160 casos de reconocimiento y exclusión. Para ejecutar las pruebas de NestJS desde la raíz del fork:

```sh
cargo test -p oxc_linter nestjs
```

Con el wrapper de Oxlint compilado y las dependencias del demo ya instaladas, el harness comprueba el catálogo, esquema, tipos, diagnósticos y modos de fix. También arranca una aplicación NestJS real en un puerto efímero: el método de instancia responde HTTP 200, el estático produce HTTP 404 y su llamada directa en JavaScript funciona. El consumidor temporal y el servidor se limpian al terminar; el demo se utiliza para resolver dependencias y no se modifica:

```sh
node forks/nestjs/test-http-handlers.mjs \
  --cli apps/oxlint/dist/cli.js \
  --demo-dir ../polaris/experiments/nestjs-demo
```

## Desarrollo de reglas y posible contribución upstream

Antes de cada regla acordaremos el comportamiento, excepciones justificadas y posibilidad de autofix. Sus tests deben incluir patrones reales de NestJS y casos que no deben producir diagnósticos. Las primeras reglas cubren los handlers HTTP estáticos y la excepción de `class-methods-use-this` para sus métodos de instancia; los demás contratos de NestJS se revisarán por separado.

Un PR al proyecto oficial puede proponerse más adelante, pero la [guía de contribución](https://oxc.rs/docs/contribute/linter/adding-rules.html) pide discutir previamente los nuevos grupos de reglas en Rust y actualmente prioriza plugins JavaScript para nuevos grupos. No hay compromiso de aceptación. Prepararemos cambios acotados, tests y documentación, separando la infraestructura de distribución del fork de las reglas que se propongan. La política de upstream exige declarar el uso de IA y que el contribuidor revise y asuma la responsabilidad del código antes de enviarlo.
