'use strict'

module.exports = (sequelize, Sequelize) => {

    const DynastyRankings = sequelize.define("dynastyrankings", {

        date: {
            type: Sequelize.DATEONLY,
            primaryKey: true,
        },
        values: {
            type: Sequelize.JSONB
        }
    });

    return DynastyRankings;
}