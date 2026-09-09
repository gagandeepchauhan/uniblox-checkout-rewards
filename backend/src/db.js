import knex from 'knex';
import { databaseConfig } from './config.js';

export const db = knex(databaseConfig);
