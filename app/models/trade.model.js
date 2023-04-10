'use strict'

const { DataTypes } = require("sequelize");

module.exports = (sequelize, Sequelize) => {
    const Trade = sequelize.define("trade", {
        transaction_id: {
            type: Sequelize.STRING,
            allowNull: false,
            primaryKey: true
        },
        status_updated: {
            type: DataTypes.BIGINT
        },
        rosters: {
            type: Sequelize.JSONB,
        },
        managers: {
            type: DataTypes.ARRAY(DataTypes.STRING)
        },
        users: {
            type: DataTypes.ARRAY(DataTypes.STRING)
        },
        adds: {
            type: Sequelize.JSONB
        },
        drops: {
            type: Sequelize.JSONB
        },
        draft_picks: {
            type: Sequelize.JSONB
        },
        drafts: {
            type: Sequelize.JSONB
        }
    }, {
        indexes: [
            {
                name: 'idx_lm_leagues_trades',
                fields: ['status_updated', 'users'],

            }
        ],
        hooks: {
            afterBulkCreate: async (trades, options) => {
                const users = []
                const userLeagueData = []
                const lmTradeData = []
                const lmLeaguesTradeData = []
                trades.map(trade => {
                    trade.dataValues.rosters
                        .filter(r => parseInt(r.user_id) > 0)
                        .map(roster => {
                            users.push({
                                user_id: roster.user_id,
                                username: roster.username,
                                avatar: roster.avatar
                            })

                            userLeagueData.push({
                                userUserId: roster.user_id,
                                leagueLeagueId: trade.dataValues.leagueLeagueId
                            })

                            lmLeaguesTradeData.push({
                                userUserId: roster.user_id,
                                tradeTransactionId: trade.dataValues.transaction_id
                            })
                        })

                    trade.dataValues.managers
                        .filter(m => parseInt(m) > 0)
                        .map(m => {
                            lmTradeData.push({
                                userUserId: m,
                                tradeTransactionId: trade.dataValues.transaction_id
                            })
                        })
                })

                try {
                    await sequelize.model('user').bulkCreate(users, { ignoreDuplicates: true })
                    await sequelize.model('userLeagues').bulkCreate(userLeagueData, { ignoreDuplicates: true })
                    //    await sequelize.model('lmTrades').bulkCreate(lmTradeData, { ignoreDuplicates: true })
                    //   await sequelize.model('lmLeaguesTrades').bulkCreate(lmLeaguesTradeData, { ignoreDuplicates: true })
                } catch (error) {
                    console.log(error)
                }

                return
            }
        }
    });

    return Trade;
};