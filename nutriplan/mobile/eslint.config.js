// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Keep the bundle small: icons come from src/components/ds/icons.ts (per-icon imports).
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'lucide-react-native', message: "Import icons from '@/components/ds/icons' instead." }] }],
    },
  },
]);
