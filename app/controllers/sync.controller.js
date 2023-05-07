'use strict'
const db = require("../models");
const User = db.users;
const League = db.leagues;
const Trade = db.trades;
const Op = db.Sequelize.Op;

const axios = require('../api/axiosInstance');
const ALLPLAYERS = require('../../allplayers.json');



exports.boot = async (app) => {
    const getAllPlayers = async () => {
        let sleeper_players;
        if (process.env.DATABASE_URL) {
            try {
                sleeper_players = await axios.get('https://api.sleeper.app/v1/players/nfl')
                sleeper_players = sleeper_players.data

            } catch (error) {
                console.log(error)
            }
        } else {
            console.log('getting allplayers from file...')

            sleeper_players = ALLPLAYERS
        }


        return sleeper_players
    }
    const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
    const allplayers = await getAllPlayers()

    app.set('state', state.data)
    app.set('allplayers', allplayers)

    app.set('syncing', 'lm')

    app.set('trades_sync_counter', 0)

    app.set('users_to_update', [])

    app.set('leagues_to_add', [])

    app.set('leagues_to_update', [])

    app.set('lm_leagues_cutoff', new Date(new Date() - 60 * 60 * 1000))

    setInterval(async () => {
        const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
        const allplayers = await getAllPlayers()

        app.set('state', state.data)
        app.set('allplayers', allplayers)

        try {
            const leagues_to_delete = await League.destroy({
                where: {
                    '$leagues.league_id$': null
                },
                include: [
                    {
                        model: User,
                        required: false
                    }
                ]
            })
            console.log(`${leagues_to_delete.length} Leagues Deleted`)
        } catch (err) {
            console.log(err)
        }
    }, 12 * 60 * 60 * 1000)
}

exports.trades = async (app) => {

    let interval = 1 * 60 * 1000

    setInterval(async () => {

        if (app.get('syncing') === 'trades') {
            console.log(`Begin Transactions Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateTrades(app)
            app.set('syncing', 'lm')
            console.log(`Transactions Sync completed at ${new Date()}`)
        } else {
            'Trade sync skipped - another sync in progress'
            return
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }


    }, interval)


    const updateTrades = async (app) => {
        const state = app.get('state')
        let i = app.get('trades_sync_counter')
        const increment = 50

        let leagues_updated = 0

        for (let i = 0; i < 250; i += 50) {
            let leagues_to_update;
            try {
                leagues_to_update = await League.findAll({
                    where: {
                        season: state.league_season
                    },
                    order: [['createdAt', 'ASC']],
                    offset: i,
                    limit: i + increment
                })
            } catch (error) {
                console.log(error)
            }
            console.log(`Updating trades for ${i + 1}-${Math.min(i + 1 + increment, i + leagues_to_update.length)} Leagues...`)


            const trades_league = []

            await Promise.all(
                leagues_to_update
                    .map(async league => {

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

                                    const pricecheck = []
                                    managers.map(user_id => {
                                        const count = Object.keys(adds).filter(a => adds[a] === user_id).length
                                            + draft_picks.filter(pick => pick.new_user.user_id === user_id).length

                                        if (count === 1) {
                                            const player = Object.keys(adds).find(a => adds[a] === user_id)
                                            if (player) {
                                                pricecheck.push(player)
                                            } else {
                                                const pick = draft_picks.find(pick => pick.new_user.user_id === user_id)
                                                pricecheck.push(`${pick.season} ${pick.round}.${pick.order}`)
                                            }
                                        }
                                    })


                                    if (transaction.type === 'trade') {

                                        trades_league.push({
                                            transaction_id: transaction.transaction_id,
                                            leagueLeagueId: league.dataValues.league_id,
                                            status_updated: transaction.status_updated,
                                            rosters: league.dataValues.rosters,
                                            managers: managers,
                                            players: [...Object.keys(adds), ...draft_picks.map(pick => `${pick.season} ${pick.round}.${pick.order}`)],
                                            adds: adds,
                                            drops: drops,
                                            draft_picks: draft_picks,
                                            drafts: league.dataValues.drafts,
                                            price_check: pricecheck
                                        })
                                    }

                                })

                        } catch (error) {
                            console.log(error)
                        }


                    }))

            try {
                await Trade.bulkCreate(trades_league, { ignoreDuplicates: true, returning: false })
                leagues_updated += trades_league.length
            } catch (error) {
                console.log(error)
            }
        }

        if (leagues_updated < 250) {
            app.set('trades_sync_counter', 0)
        } else {
            app.set('trades_sync_counter', i + increment)
        }

    }
}


exports.leaguemates = async (app) => {
    let interval = 1 * 60 * 1000

    setInterval(async () => {



        if (app.get('syncing') === 'lm') {
            console.log(`Begin Leaguemates Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateLeaguemateLeagues(app)
            app.set('syncing', 'trades')
            console.log(`Leaguemates Sync completed at ${new Date()}`)
        } else {
            'Trade sync skipped - another sync in progress'
            return
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }

    }, interval)

    const updateLeaguemateLeagues = async (app) => {
        const state = app.get('state')

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

        // update leagues  that haven't been updated in 24 hrs

        const cutoff = new Date(new Date() - (24 * 60 * 60 * 1000))

        const leagues_to_update = Array.from(new Set([
            ...app.get('leagues_to_update'),
            ...leagues_user_db.filter(l_db => l_db.updatedAt < cutoff).flatMap(league => league.league_id)
        ]))

        console.log(`${leagues_to_add.length} Leagues to Add... (${app.get('leagues_to_add').length} from previous)`)
        console.log(`${leagues_to_update.length} Leagues to Update... (${app.get('leagues_to_update').length} from previous)`)

        let leagues_batch;

        const increment = 150;
        const increment_new = (state.display_week > 0 || state.display_week < 19)
            ? (increment - (25 * state.display_week))
            : increment

        if (leagues_to_add.length > 0) {
            const leagues_to_add_batch = leagues_to_add.slice(0, increment_new)

            console.log(`Adding ${leagues_to_add_batch.length} Leagues`)

            const leagues_to_add_pending = leagues_to_add.filter(l => !leagues_to_add_batch.includes(l))

            app.set('leagues_to_add', leagues_to_add_pending)

            app.set('leagues_to_update', leagues_to_update)

            leagues_batch = await getBatchLeaguesDetails(leagues_to_add_batch, state.display_week, true)

            const matchup_keys = Array.from(Array(Math.max(state.display_week, 18)).keys()).map(key => `matchups_${key + 1}`)

            await League.bulkCreate(leagues_batch, {
                updateOnDuplicate: ["name", "avatar", "settings", "scoring_settings", "roster_positions",
                    "rosters", "drafts", ...matchup_keys, "updatedAt"]
            })

        } else if (leagues_to_update.length > 0) {
            const leagues_to_update_batch = leagues_to_update.slice(0, increment)

            console.log(`Updating ${leagues_to_update_batch.length} Leagues`)

            const leagues_to_update_pending = leagues_to_update.filter(l => !leagues_to_update_batch.includes(l))

            app.set('leagues_to_update', leagues_to_update_pending)

            leagues_batch = await getBatchLeaguesDetails(leagues_to_update_batch, state.display_week, false)

            const matchup_keys = (state.display_week > 0 && state.display_week < 19) ? [`matchups_${state.display_week}`] : []

            await League.bulkCreate(leagues_batch, {
                updateOnDuplicate: ["name", "avatar", "settings", "scoring_settings", "roster_positions",
                    "rosters", "drafts", ...matchup_keys, "updatedAt"]
            })

        }



        return
    }

    const getLeaguemateLeagues = async (app, state) => {
        let users_to_update = app.get('users_to_update')
        let leagues_to_update = app.get('leagues_to_add')
        let leagues_to_add = app.get('leagues_to_add')

        if (!(leagues_to_add.length + leagues_to_update.length > 0)) {

            // set current time as the cutoff for next sync

            const lm_leagues_cutoff = app.get('lm_leagues_cutoff')
            app.set('lm_leagues_cutoff', new Date())


            // get users that have been created since last cutoff or not updated in last 6 hrs

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


            // concat users just retrieved from db to users pending from previous syncs

            let all_users_to_update = Array.from(new Set([...users_to_update, ...new_users_to_update.flatMap(user => user.dataValues.user_id)]))

            // get first 100 users from concat array

            let users_to_update_batch = all_users_to_update.slice(0, 100)

            // set 'users_to_update' with current users being synced filtered out

            app.set('users_to_update', all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)))

            console.log(`Updating ${users_to_update_batch.length} of ${all_users_to_update.length} users - (${new_users_to_update.flatMap(user => user.dataValues.user_id).filter(u => !users_to_update.includes(u)).length} New, ${users_to_update.length} from previous...)`)
            // get dictionary of leagues - stored as object to remove duplicates
            let leaguemate_leagues = {}

            for (const lm of users_to_update_batch) {
                try {
                    const lm_leagues = await axios.get(`http://api.sleeper.app/v1/user/${lm}/leagues/nfl/${state.league_season}`)
                    if (lm_leagues?.data?.length > 0) {
                        lm_leagues.data.map(league => {
                            let leagues = leaguemate_leagues[league.league_id] || []
                            leagues.push(league.league_id)
                            return leaguemate_leagues[league.league_id] = leagues
                        })
                    } else {
                        await User.destroy({
                            where: {
                                user_id: lm
                            }
                        })
                    }
                } catch (error) {
                    console.log(error)
                }
            }

            return leaguemate_leagues
        } else {
            return {}
        }

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

            for (const pick of traded_picks.filter(x => x.owner_id === rosters[i].roster_id)) {
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
            }

            for (const pick of traded_picks.filter(x => x.previous_owner_id === rosters[i].roster_id)) {
                const index = original_picks[rosters[i].roster_id].findIndex(obj => {
                    return obj.season === pick.season && obj.round === pick.round && obj.roster_id === pick.roster_id
                })

                if (index !== -1) {
                    original_picks[rosters[i].roster_id].splice(index, 1)
                }
            }
        }



        return original_picks
    }

    const getLeagueDetails = async (leagueId, display_week, new_league) => {
        try {
            const league = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}`)
            const users = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/users`)
            const rosters = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)
            const drafts = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/drafts`)
            const traded_picks = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`)

            let matchups = {};
            if (display_week > 0 && display_week < 19) {
                const matchup_week = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${display_week}`)
                matchups[`matchups_${display_week}`] = matchup_week.data
            }

            if (new_league) {
                (await Promise.all(Array.from(Array(Math.max(display_week, 18)).keys())))
                    .map(async week => {
                        const matchup_prev = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week + 1}`)

                        matchups[`matchups_${week + 1}`] = matchup_prev.data

                    })
            }

            await User.bulkCreate(users.data.map(user => {
                return {
                    user_id: user.user_id,
                    username: user.display_name,
                    avatar: user.avatar
                }
            }), {
                updateOnDuplicate: ['username', 'avatar']
            })

            if (!new_league) {
                await db.sequelize.model('userLeagues').bulkCreate(users.data.map(user => {
                    return {
                        userUserId: user.user_id,
                        leagueLeagueId: league.data.league_id
                    }
                }), {
                    ignoreDuplicates: true
                })

                await db.sequelize.model('userLeagues').destroy({
                    where: {
                        [db.Sequelize.Op.and]: [
                            {
                                leagueLeagueId: league.data.league_id
                            },
                            {
                                userUserId: {
                                    [db.Sequelize.Op.not]: users.data.map(user => user.user_id)
                                }
                            }
                        ]
                    }
                })
            }
            const draft_picks = getDraftPicks(traded_picks.data, rosters.data, users.data, drafts.data, league.data)

            const drafts_array = []

            for (const draft of drafts.data) {
                drafts_array.push({
                    draft_id: draft.draft_id,
                    status: draft.status,
                    rounds: draft.settings.rounds,
                    draft_order: draft.draft_order
                })
            }


            const rosters_username = rosters.data
                ?.sort(
                    (a, b) =>
                        (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)
                        || (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0)
                );

            for (const [index, roster] of rosters_username.entries()) {
                const user = users.data.find(u => u.user_id === roster.owner_id);
                const co_owners = roster.co_owners?.map(co => {
                    const co_user = users.data.find(u => u.user_id === co);
                    return {
                        user_id: co_user?.user_id,
                        username: co_user?.display_name,
                        avatar: co_user?.avatar
                    };
                });
                rosters_username[index] = {
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
                    co_owners,
                    draft_picks: draft_picks[roster.roster_id]
                };
            }

            const { type, best_ball } = league.data.settings || {}
            const settings = { type, best_ball }

            return {
                league_id: leagueId,
                name: league.data.name,
                avatar: league.data.avatar,
                season: league.data.season,
                settings: settings,
                scoring_settings: league.data.scoring_settings,
                roster_positions: league.data.roster_positions,
                rosters: rosters_username,
                drafts: drafts_array,
                ...matchups,
                updatedAt: Date.now()
            }
        } catch (error) {
            console.error(error);

        }
    }

    const getBatchLeaguesDetails = async (leagueIds, display_week, new_league) => {

        const allResults = [];

        const chunkSize = 10;

        for (let i = 0; i < leagueIds.length; i += chunkSize) {
            const chunk = leagueIds.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (leagueId) => {
                const result = await getLeagueDetails(leagueId, display_week, new_league);
                return result !== null ? result : undefined;
            }));
            allResults.push(...chunkResults);
        }

        return allResults.filter(result => result !== undefined);
    }
}











