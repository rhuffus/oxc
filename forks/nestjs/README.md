# Oxlint para NestJS — fork de rhuffus

Este fork de [Oxc](https://github.com/oxc-project/oxc) servirá para desarrollar validaciones de NestJS integradas en Rust. La primera versión prepara la compilación y distribución; todavía no añade reglas de NestJS. La base inicial es el tag oficial `oxlint_v1.82.0`.

La rama de trabajo es `codex/nestjs`. La rama `main` se conserva para seguir upstream. Los scripts de distribución del fork viven en `forks/nestjs/`; el código de las futuras reglas vivirá junto a las reglas nativas de `crates/oxc_linter`.

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

La verificación instala el tarball en un proyecto temporal y prueba el CLI, la configuración TypeScript, un plugin JavaScript, los exports y la identidad del módulo nativo. No se publica en el registro npm. GitHub Actions usa su `GITHUB_TOKEN` para adjuntar los archivos al propio fork.

Para reproducirlo localmente en Apple Silicon, desde la raíz del fork:

```sh
pnpm install --frozen-lockfile
node forks/nestjs/build-package.mjs 1
node forks/nestjs/smoke-package.mjs target/nestjs-release/oxlint-1.82.0-nestjs.1.tgz apps/oxlint/src-js/oxlint.darwin-arm64.node
```

Los archivos de salida están en `target/nestjs-release/`. El empaquetador restaura los cargadores fuente después de generar el bundle específico de esta plataforma. Las futuras actualizaciones de upstream deben revisar el empaquetado y repetir estas pruebas. Añadir otras plataformas requerirá builds y paquetes específicos.

## Desarrollo de reglas y posible contribución upstream

Antes de cada regla acordaremos el comportamiento, excepciones justificadas y posibilidad de autofix. Sus tests deben incluir patrones reales de NestJS y casos válidos que no deben producir diagnósticos. La prohibición de handlers HTTP estáticos es el primer candidato; todavía no está implementada. Prohibirlos no resuelve por sí solo la política de `class-methods-use-this`, que revisaremos conjuntamente.

Un PR al proyecto oficial puede proponerse más adelante, pero la [guía de contribución](https://oxc.rs/docs/contribute/linter/adding-rules.html) pide discutir previamente los nuevos grupos de reglas en Rust y actualmente prioriza plugins JavaScript para nuevos grupos. No hay compromiso de aceptación. Prepararemos cambios acotados, tests y documentación, separando la infraestructura de distribución del fork de las reglas que se propongan. La política de upstream exige declarar el uso de IA y que el contribuidor revise y asuma la responsabilidad del código antes de enviarlo.
