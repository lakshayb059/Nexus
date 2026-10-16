const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { defineConfig, env } = require('prisma/config');

module.exports = defineConfig({
  schema: 'server/prisma/schema.prisma',
  migrations: {
    path: 'server/prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
