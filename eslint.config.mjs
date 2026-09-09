import js from '@eslint/js';
import react from 'eslint-plugin-react';

export default [
    js.configs.recommended,
    {
        files: ['**/*.{js,jsx}'],
        ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                document: 'readonly',
                fetch: 'readonly'
            }
        },
        plugins: { react },
        rules: {
            indent: ['error', 4, { SwitchCase: 1 }],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'react/jsx-uses-vars': 'error'
        }
    }
];
