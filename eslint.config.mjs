import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import pluginUnused from 'eslint-plugin-unused-imports';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      import: pluginImport,
      'unused-imports': pluginUnused,
    },
    rules: {
      // ES6+/readability
      'no-var': 'error',
      'prefer-const': 'warn',
      'arrow-body-style': ['warn', 'as-needed'],
      'object-curly-newline': ['warn', { ObjectExpression: { consistent: true } }],
      'array-bracket-newline': ['warn', { multiline: true, minItems: 4 }],
      'array-element-newline': ['warn', { multiline: true, minItems: 4 }],

      // Import hygiene
      'import/first': 'warn',
      'import/no-duplicates': 'warn',
      'unused-imports/no-unused-imports': 'warn',

      // Let Prettier handle formatting conflicts
      'no-mixed-spaces-and-tabs': 'off',
    },
  },
];
