'use strict'
const db = require("../models");
const User = db.users;
const League = db.leagues;
const Trade = db.trades;
const Op = db.Sequelize.Op;
const https = require('https');
const axios = require('axios').create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
    timeout: 2000
});
const axiosRetry = require('axios-retry');

axiosRetry(axios, {
    retries: 3,
    retryCondition: () => {
        return true;
    },
    retryDelay: (retryCount) => {
        return retryCount * 1000
    },
})

exports.boot = async (app) => {
    const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
    app.set('state', state.data)

    app.set('trades_sync_counter', 0)

    app.set('users_to_update', [])

    app.set('leagues_to_add', [])

    app.set('leagues_to_update', [])

    app.set('lm_leagues_cutoff', new Date(new Date() - 60 * 60 * 1000))

    setInterval(async () => {
        const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
        app.set('state', state.data)
    }, 1 * 60 * 60 * 1000)
}

exports.trades = async (app) => {
    setTimeout(async () => {
        let interval = 2.5 * 60 * 1000

        setInterval(async () => {
            if (app.get('syncing') !== 'true') {
                console.log(`Begin Transactions Sync at ${new Date()}`)
                app.set('syncing', 'true')
                await updateTrades(app)
                app.set('syncing', 'false')
                console.log(`Transactions Sync completed at ${new Date()}`)
            }

            const used = process.memoryUsage()
            for (let key in used) {
                console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
            }
        }, interval)
    }, 15 * 1000)

    const updateTrades = async (app) => {
        const state = app.get('state')
        let i = app.get('trades_sync_counter')
        const increment = 500

        let leagues_to_update;
        try {
            leagues_to_update = await League.findAll({
                where: {
                    season: state.league_season
                },
                order: [['createdAt', 'ASC']],
                offset: i,
                limit: increment
            })
        } catch (error) {
            console.log(error)
        }
        console.log(`Updating trades for ${i + 1}-${Math.min(i + 1 + increment, i + leagues_to_update.length)} Leagues...`)


        await Promise.all(leagues_to_update
            .filter(x => x.dataValues.rosters.find(r => r.players?.length > 0))
            .map(async league => {
                let trades_league = []
                let transactions_league;

                try {
                    transactions_league = await axios.get(`https://api.sleeper.app/v1/league/${league.dataValues.league_id}/transactions/${state.season_type === 'regular' ? state.week : 1}`)
                } catch (error) {
                    console.log(error)
                    transactions_league = {
                        data: []
                    }
                }

                try {
                    transactions_league.data
                        .map(transaction => {
                            const draft_order = league.dataValues.drafts.find(d => d.draft_order && d.status !== 'complete')?.draft_order

                            const managers = transaction.roster_ids.map(roster_id => {
                                const user = league.dataValues.rosters?.find(x => x.roster_id === roster_id)

                                return user?.user_id
                            })

                            const draft_picks = transaction.draft_picks.map(pick => {
                                const roster = league.dataValues.rosters.find(x => x.roster_id === pick.roster_id)
                                const new_roster = league.dataValues.rosters.find(x => x.roster_id === pick.owner_id)
                                const old_roster = league.dataValues.rosters.find(x => x.roster_id === pick.previous_owner_id)

                                return {
                                    ...pick,
                                    original_user: {
                                        user_id: roster?.user_id,
                                        username: roster?.username,
                                        avatar: roster?.avatar,
                                    },
                                    new_user: {
                                        user_id: new_roster?.user_id,
                                        username: new_roster?.username,
                                        avatar: new_roster?.avatar,
                                    },
                                    old_user: {
                                        user_id: old_roster?.user_id,
                                        username: old_roster?.username,
                                        avatar: old_roster?.avatar,
                                    },
                                    order: draft_order && roster?.user_id && pick.season === state.league_season ? draft_order[roster?.user_id] : null
                                }
                            })

                            let adds = {}
                            transaction.adds && Object.keys(transaction.adds).map(add => {
                                const user = league.dataValues.rosters?.find(x => x.roster_id === transaction.adds[add])
                                return adds[add] = user?.user_id
                            })

                            let drops = {}
                            transaction.drops && Object.keys(transaction.drops).map(drop => {
                                const user = league.dataValues.rosters?.find(x => x.roster_id === transaction.drops[drop])
                                return drops[drop] = user?.user_id
                            })

                            if (transaction.type === 'trade') {

                                trades_league.push({
                                    transaction_id: transaction.transaction_id,
                                    leagueLeagueId: league.dataValues.league_id,
                                    status_updated: transaction.status_updated,
                                    rosters: league.dataValues.rosters,
                                    managers: managers,
                                    users: league.dataValues.rosters.filter(r => parseInt(r.user_id) > 0).map(r => r.user_id),
                                    adds: adds,
                                    drops: drops,
                                    draft_picks: draft_picks,
                                    drafts: league.dataValues.drafts
                                })
                            }

                        })
                } catch (error) {
                    console.log(error)
                }
                try {
                    await Trade.bulkCreate(trades_league, { ignoreDuplicates: true })
                } catch (error) {
                    console.log(error)

                }

            })
        )



        if (leagues_to_update.length < increment) {
            app.set('trades_sync_counter', 0)
        } else {
            app.set('trades_sync_counter', i + increment)
        }


        return
    }
}


exports.leaguemates = async (app) => {
    let interval = 60 * 1000

    setInterval(async () => {
        if (app.get('syncing') !== 'true') {
            console.log(`Begin Leaguemates Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateLeaguemateLeagues(app)
            app.set('syncing', 'false')
            console.log(`Leaguemates Sync completed at ${new Date()}`)
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }
    }, interval)

    const updateLeaguemateLeagues = async (app) => {
        const state = app.get('state')
        const week = state.season_type === 'regular' ? state.week : 1
        const increment_new = 100;

        const cutoff = new Date(new Date() - (24 * 60 * 60 * 1000))

        const league_ids_dict = await getLeaguemateLeagues(app, state)
        const league_ids = Object.keys(league_ids_dict)

        let leagues_user_db;

        if (league_ids.length > 0) {
            try {
                leagues_user_db = await League.findAll({
                    where: {
                        league_id: {
                            [Op.in]: league_ids
                        }
                    }
                })
            } catch (error) {
                console.log(error)
            }
        } else {
            leagues_user_db = []
        }

        leagues_user_db = leagues_user_db.map(league => league.dataValues)

        const leagues_to_add = Array.from(new Set([
            ...app.get('leagues_to_add'),
            ...league_ids
                .filter(l => !leagues_user_db.find(l_db => l_db.league_id === l))
        ].flat()))

        const leagues_to_update = Array.from(new Set([
            ...app.get('leagues_to_update'),
            ...leagues_user_db.filter(l_db => l_db.updatedAt < cutoff).map(league => league.league_id)
        ].flat()))

        console.log(`${leagues_to_add.length} Leagues to Add... (${app.get('leagues_to_add').length} from previous)`)
        console.log(`${leagues_to_update.length} Leagues to Update... (${app.get('leagues_to_update').length} from previous)`)

        let leagues_batch;

        if (leagues_to_add.length > 0) {
            const leagues_to_add_batch = leagues_to_add.slice(0, increment_new)

            console.log(`Adding ${leagues_to_add_batch.length} Leagues`)

            const leagues_to_add_pending = leagues_to_add.filter(l => !leagues_to_add_batch.includes(l))

            app.set('leagues_to_add', leagues_to_add_pending)

            app.set('leagues_to_update', leagues_to_update)

            leagues_batch = await getLeaguesToAdd(leagues_to_add_batch, state.league_season, state, 'add')

        } else if (leagues_to_update.length > 0) {
            const leagues_to_update_batch = leagues_to_update.slice(0, 250)

            console.log(`Updating ${leagues_to_update_batch.length} Leagues`)

            const leagues_to_update_pending = leagues_to_update.filter(l => !leagues_to_update_batch.includes(l))

            app.set('leagues_to_update', leagues_to_update_pending)

            leagues_batch = await getLeaguesToAdd(leagues_to_update_batch, state.league_season, state, 'update')

        }

        if (leagues_to_add.length > 0 || leagues_to_update.length > 0) {


            await League.bulkCreate(leagues_batch, {
                updateOnDuplicate: ["name", "avatar", "settings", "scoring_settings", "roster_positions",
                    "rosters", "drafts", `matchups_${week}`, "updatedAt"]
            })
        }


        return
    }

    const getLeaguemateLeagues = async (app, state) => {
        const lm_leagues_cutoff = app.get('lm_leagues_cutoff')
        app.set('lm_leagues_cutoff', new Date())

        let users_to_update = app.get('users_to_update')

        let new_users_to_update = await User.findAll({
            where: {
                [Op.and]: [
                    {
                        type: ['LM', 'S']
                    },
                    {
                        [Op.or]: [
                            {
                                updatedAt: {
                                    [Op.lt]: new Date(new Date() - 6 * 60 * 60 * 1000)
                                }
                            },
                            {
                                createdAt: {
                                    [Op.gt]: lm_leagues_cutoff
                                }
                            }
                        ]
                    }

                ]
            }
        })

        let all_users_to_update = Array.from(new Set([...users_to_update, ...new_users_to_update.map(user => user.dataValues.user_id)].flat()))

        let users_to_update_batch = all_users_to_update.slice(0, 500)

        const users_to_update_batch_time = users_to_update_batch.map(user => {
            return {
                user_id: user,
                updatedAt: new Date()
            }
        })

        try {
            await User.bulkCreate(users_to_update_batch_time, { updateOnDuplicate: ['updatedAt'] })
        } catch (error) {
            console.log(error)
        }

        console.log(`Updating ${users_to_update_batch.length} of ${all_users_to_update.length} Total Users (${users_to_update.length} Existing, ${new_users_to_update.length} New)
        : ${all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)).length} Users pending...`)

        app.set('users_to_update', all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)))

        let leaguemate_leagues = {}

        await Promise.all(users_to_update_batch
            ?.map(async lm => {
                try {
                    const lm_leagues = await axios.get(`http://api.sleeper.app/v1/user/${lm}/leagues/nfl/${state.league_season}`)
                    lm_leagues.data.map(league => {
                        let leagues = leaguemate_leagues[league.league_id] || []
                        leagues.push(league.league_id)
                        return leaguemate_leagues[league.league_id] = leagues
                    })
                } catch (error) {
                    console.log(error)
                }
            }))





        return leaguemate_leagues
    }

    const getLeaguesToAdd = async (leagues_to_add, season, state, type) => {
        const week = state.season_type === 'regular' ? state.week : 1
        let new_leagues = []
        let j = 0;
        let increment_new = type === 'update' || week <= 1 ? 150 : 50

        while (j < leagues_to_add.length) {
            await Promise.all(leagues_to_add
                .slice(j, Math.min(j + increment_new, leagues_to_add.length))
                .map(async (league_id) => {
                    let league, users, rosters, drafts, traded_picks;

                    try {
                        [league, users, rosters, drafts, traded_picks] = await Promise.all([
                            await axios.get(`https://api.sleeper.app/v1/league/${league_id}`),
                            await axios.get(`https://api.sleeper.app/v1/league/${league_id}/users`),
                            await axios.get(`https://api.sleeper.app/v1/league/${league_id}/rosters`),
                            await axios.get(`https://api.sleeper.app/v1/league/${league_id}/drafts`),
                            await axios.get(`https://api.sleeper.app/v1/league/${league_id}/traded_picks`)
                        ])


                        let draft_picks;

                        if (state.league_season === season) {
                            draft_picks = getDraftPicks(traded_picks.data, rosters.data, users.data, drafts.data, league.data)
                        }



                        let matchups = {};

                        try {
                            if (type === 'add') {
                                await Promise.all(Array.from(Array(week).keys()).map(async key => {
                                    let matchups_week = await axios.get(`https://api.sleeper.app/v1/league/${league_id}/matchups/${key + 1}`)
                                    matchups[`matchups_${key + 1}`] = matchups_week.data
                                }))
                            } else {
                                let matchups_week = await axios.get(`https://api.sleeper.app/v1/league/${league_id}/matchups/${week}`)
                                matchups[`matchups_${week}`] = matchups_week.data
                            }
                        } catch (error) {
                            console.log(error)
                        }


                        if (league?.data) {
                            const new_league = {
                                league_id: league_id,
                                name: league.data.name,
                                avatar: league.data.avatar,
                                season: league.data.season,
                                settings: league.data.settings,
                                scoring_settings: league.data.scoring_settings,
                                roster_positions: league.data.roster_positions,
                                rosters: rosters.data
                                    ?.sort((a, b) => b.settings?.wins - a.settings.wins || b.settings.fpts - a.settings.fpts)
                                    ?.map((roster, index) => {
                                        const user = users.data.find(u => u.user_id === roster.owner_id)
                                        return {
                                            rank: index + 1,
                                            taxi: roster.taxi,
                                            starters: roster.starters,
                                            settings: roster.settings,
                                            roster_id: roster.roster_id,
                                            reserve: roster.reserve,
                                            players: roster.players,
                                            user_id: roster.owner_id,
                                            username: user?.display_name,
                                            avatar: user?.avatar,
                                            co_owners: roster.co_owners?.map(co => {
                                                const co_user = users.data.find(u => u.user_id === co)
                                                return {
                                                    user_id: co_user?.user_id,
                                                    username: co_user?.display_name,
                                                    avatar: co_user?.avatar
                                                }
                                            }),
                                            draft_picks: draft_picks[roster.roster_id]

                                        }
                                    }),
                                drafts: drafts?.data?.map(draft => {
                                    return {
                                        draft_id: draft.draft_id,
                                        status: draft.status,
                                        rounds: draft.settings.rounds,
                                        draft_order: draft.draft_order
                                    }
                                }) || [],
                                ...matchups,
                                updatedAt: Date.now()
                            }

                            new_leagues.push(new_league)
                        }

                    } catch (error) {
                        console.log(error)
                    }
                })
            )
            j += increment_new
        }


        return new_leagues
    }

    const getDraftPicks = (traded_picks, rosters, users, drafts, league) => {
        let draft_season;
        if (!drafts.find(x => x.status === 'pre_draft' && x.settings.rounds === league.settings.draft_rounds)) {
            draft_season = parseInt(league.season) + 1
        } else {
            draft_season = parseInt(league.season)
        }

        const draft_order = drafts.find(x => x.status !== 'complete' && x.settings.rounds === league.settings.draft_rounds)?.draft_order

        let original_picks = {}

        for (let i = 0; i < rosters.length; i++) {
            original_picks[rosters[i].roster_id] = []
            for (let j = parseInt(draft_season); j <= parseInt(draft_season) + 2; j++) {

                for (let k = 1; k <= league.settings.draft_rounds; k++) {
                    const original_user = users.find(u => u.user_id === rosters[i].owner_id)

                    if (!traded_picks.find(pick => parseInt(pick.season) === j && pick.round === k && pick.roster_id === rosters[i].roster_id)) {
                        original_picks[rosters[i].roster_id].push({
                            season: j,
                            round: k,
                            roster_id: rosters[i].roster_id,
                            original_user: {
                                avatar: original_user?.avatar || null,
                                user_id: original_user?.user_id || '0',
                                username: original_user?.display_name || 'Orphan'
                            },
                            order: draft_order && draft_order[original_user?.user_id]
                        })
                    }
                }
            }

            traded_picks.filter(x => x.owner_id === rosters[i].roster_id)
                .map(pick => {
                    const original_user = users.find(u => rosters.find(r => r.roster_id === pick.roster_id)?.owner_id === u.user_id)
                    return original_picks[rosters[i].roster_id].push({
                        season: parseInt(pick.season),
                        round: pick.round,
                        roster_id: pick.roster_id,
                        original_user: {
                            avatar: original_user?.avatar || null,
                            user_id: original_user?.user_id || '0',
                            username: original_user?.display_name || 'Orphan'
                        },
                        order: draft_order && draft_order[original_user?.user_id]
                    })
                })

            traded_picks.filter(x => x.previous_owner_id === rosters[i].roster_id)
                .map(pick => {
                    const index = original_picks[rosters[i].roster_id].findIndex(obj => {
                        return obj.season === pick.season && obj.round === pick.round && obj.roster_id === pick.roster_id
                    })

                    if (index !== -1) {
                        original_picks[rosters[i].roster_id].splice(index, 1)
                    }
                })
        }



        return original_picks
    }
}

