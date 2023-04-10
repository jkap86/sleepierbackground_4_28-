'use strict'
const dbConfig = require("../config/db.config");

const Sequelize = require("sequelize");

const ssl = process.env.HEROKU ? { rejectUnauthorized: false } : false

const sequelize = new Sequelize(dbConfig.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: ssl, useUTC: false },
    logging: false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.users = require("./user.model.js")(sequelize, Sequelize);
db.leagues = require("./league.model.js")(sequelize, Sequelize);
db.trades = require("./trade.model.js")(sequelize, Sequelize);

db.users.belongsToMany(db.leagues, { through: 'userLeagues' })
db.leagues.belongsToMany(db.users, { through: 'userLeagues' })

db.leagues.hasMany(db.trades)
db.trades.belongsTo(db.leagues)

module.exports = db;