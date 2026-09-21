export default {
  sourceDir: '.',
  artifactsDir: 'dist',
  ignoreFiles: [
    'tests/**', 'deploy/**', '*.md', 'package*.json',
    'web-ext-config.mjs', '.gitignore', '.github/**', 'dist/**',
    'connection.json', 'callers.json', '*.duckdb', '*.duckdb.wal', '.env*'
  ],
  build: {overwriteDest: true}
};
