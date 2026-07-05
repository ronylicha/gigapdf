import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    setupFiles: ['__tests__/vitest-setup.ts'],
    pool: 'forks',
    // Vitest 4 a retiré `test.poolOptions` (singleFork/min/maxForks/execArgv y
    // sont désormais IGNORÉS silencieusement). Équivalent v4 : exécution
    // séquentielle mono-worker (borne le pic mémoire des tests round-trip gros
    // PDF) avec l'isolation par défaut (isolate: true → registre de modules
    // frais par fichier). Le heap est hérité du parent ; passer par
    // NODE_OPTIONS=--max-old-space-size=… au niveau du script si besoin.
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    server: {
      deps: {
        external: ['pdfjs-dist'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        // Seuils spécifiques pour les fichiers critiques Wave 2 fonts.
        // Ces seuils sont activés après le fix (les fichiers n'existent pas encore sur main).
        // Décommenter après le merge Wave 2 :
        //
        // 'src/utils/font-map.ts': {
        //   statements: 90,
        //   branches: 85,
        //   functions: 90,
        //   lines: 90,
        // },
        // 'src/render/text-renderer.ts': {
        //   statements: 85,
        //   branches: 80,
        //   functions: 85,
        //   lines: 85,
        // },
      },
    },
    // Timeout plus long pour les tests round-trip avec gros PDFs (ex: large-100pages.pdf)
    testTimeout: 60000,
  },
});
