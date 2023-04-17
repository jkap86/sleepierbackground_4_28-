'use strict'
const db = require("../models");
const DynastyRankings = db.dynastyrankings;
const puppeteer = require('puppeteer');
const cheerio = require('cheerio')
const https = require('https');
const axios = require('axios').create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
    timeout: 3000
});
const axiosRetry = require('axios-retry');
const ALLPLAYERS = require('../../allplayers.json');

axiosRetry(axios, { retries: 3 })



const getValue = async () => {


    console.log('getting values')
    let elements = {}
    const page = await axios.get('https://keeptradecut.com/dynasty-rankings')
    let $ = cheerio.load(page.data)
    $('.onePlayer').each((index, element) => {
        let name = $(element).find('.player-name a').text().replace('III', '').replace('II', '').replace('Jr', '')
        let link = $(element).find('.player-name a').attr('href')
        let searchName = name.replace(/[^0-9a-z]/gi, '').toLowerCase()
        const position = $(element).find('div.position-team p.position').text().slice(0, 2)
        const team = $(element).find('.player-name span.player-team').text()


        elements[link] = {
            date: new Date().toLocaleDateString("en-US"),
            value: $(element).find('.value p').text(),
            name: name,
            team: team,
            position: position,
            link: link
        }

    })
    return elements
}

const getHistorcalValues = async (players) => {

    let elements = {}
    const unmatched = {}
    for (const player of Object.keys(players)) {

        const browser = await puppeteer.launch();
        let html;
        const page = await browser.newPage();
        page.setDefaultTimeout(7000)
        while (!html) {
            try {


                await page.goto('https://keeptradecut.com/' + players[player].link);

                await page.waitForSelector('svg.pd-value-svg');

                const option_all_time = await page.$('#all-time')

                await option_all_time.click()

                await page.waitForSelector('div.config.active:has-text("All Time")')
                html = await page.content();

            } catch (error) {

                try {


                    await page.goto('https://keeptradecut.com/' + players[player].link);

                    const svg = await page.$('svg.pd-value-svg');

                    if (svg) {
                        html = await page.content();
                    }
                } catch (error) {
                    console.log({
                        name: players[player].name,
                        link: players[player].link
                    })
                    unmatched[player] = players[player]
                }
            }
        }

        await browser.close()

        let $ = cheerio.load(html)

        const jersey = $('div.player-details-header-subtext.dashboard-header-subtext').find('span').last().text().replace('#', '').trim().replace(/\n|\t/g, '')
        const meas_block1 = $('div.meas-block').first()
        const meas_block2 = $('div.meas-block').last()

        const age = meas_block1.find('p.row-value').first().text().split('.')[0].trim().replace(/\n|\t/g, '')
        const birthdate = meas_block1.find('p.row-value').eq(1).text().trim().replace(/\n|\t/g, '')

        const yrs_exp = meas_block2.find('p.row-value').eq(2).text().replace('yrs.', '').trim().replace(/\n|\t/g, '')
        const college = meas_block2.find('p.row-value').last().text().trim().replace(/\n|\t/g, '')

        $('div.pd-block.pd-value-graph g.hoverGroup').each((index, element) => {
            const date = new Date($(element).find('.hoverDate').text())
            const value = $(element).find('.hoverVal').text()

            if (!elements[date.toISOString().split('T')[0]]) {
                elements[date.toISOString().split('T')[0]] = {}
            }
            if (!elements[date.toISOString().split('T')[0]][player]) {
                elements[date.toISOString().split('T')[0]][player] = {}
            }

            elements[date.toISOString().split('T')[0]][player] = {
                age: parseInt(age),
                yrs_exp: parseInt(yrs_exp),
                birthdate: birthdate,
                college: college,
                jersey: parseInt(jersey),
                date: date.toLocaleDateString("en-US"),
                value: value,
                name: players[player].name,
                team: players[player].team,
                position: players[player].position,
                link: players[player].link
            }

            /*
            let $ = cheerio.load(html)
    
            $('div.pd-block.pd-value-graph g.hoverGroup').each((index, element) => {
                const date = new Date($(element).find('.hoverDate').text())
                const value = $(element).find('.hoverVal').text()
    
                if (!elements[date.toISOString().split('T')[0]]) {
                    elements[date.toISOString().split('T')[0]] = {}
                }
                if (!elements[date.toISOString().split('T')[0]][player]) {
                    elements[date.toISOString().split('T')[0]][player] = {}
                }
    
                elements[date.toISOString().split('T')[0]][player] = {
                    player_id: player,
                    date: date.toLocaleDateString("en-US"),
                    value: value,
                    name: players[player].name,
                    team: players[player].team,
                    position: players[player].position,
                    link: players[player].link
                }
    
            })
            */


        }


        )
        console.log(`${players[player].name} Id: ${players[player].player_id} Complete`)
    }
    return {
        rankings: elements,
        unmatched: unmatched
    }
}

const matchRankingsWeek = (date, values, stateAllPlayers) => {
    const matched_rankings = {}
    const unmatched = {}

    const matchTeam = (team) => {
        const team_abbrev = {
            SFO: 'SF',
            JAC: 'JAX',
            KCC: 'KC',
            TBB: 'TB',
            GBP: 'GB',
            NEP: 'NE',
            LVR: 'LV',
            NOS: 'NO'
        }
        return team_abbrev[team] || team
    }
    Object.keys(values).map(player => {

        if (values[player].position === 'PI') {
            matched_rankings[values[player].name.slice(0, -2)] = values[player]
        } else {

            const players_to_search = Object.keys(stateAllPlayers || {})
                .map(player_id => {
                    let match_score = 0

                    if (stateAllPlayers[player_id]?.active === true
                        && stateAllPlayers[player_id]?.position === values[player].position) {
                        match_score += 1
                    }
                    if (stateAllPlayers[player_id]?.college === values[player].college) {
                        match_score += 1
                    }
                    if (stateAllPlayers[player_id]?.number === values[player].jersey) {
                        match_score += 1
                    }
                    if ((stateAllPlayers[player_id]?.team || 'FA') === matchTeam(values[player].team)) {
                        match_score += 1
                    }
                    if (stateAllPlayers[player_id]?.years_exp === values[player].yrs_exp || 0) {
                        match_score += 1
                    }
                    if (values[player].name.trim().toLowerCase().replace(/[^a-z]/g, "") === stateAllPlayers[player_id]?.search_full_name?.trim()) {
                        match_score += 5
                    }

                    return {
                        player_id: player_id,
                        match_score: match_score
                    }
                })
                .sort((a, b) => b.match_score - a.match_score)

            matched_rankings[players_to_search[0].player_id] = values[player]


        }
    })
    return {
        date: date,
        values: matched_rankings
    }
}

const matchPlayer = (player, stateAllPlayers) => {
    const matchTeam = (team) => {
        const team_abbrev = {
            SFO: 'SF',
            JAC: 'JAX',
            KCC: 'KC',
            TBB: 'TB',
            GBP: 'GB',
            NEP: 'NE',
            LVR: 'LV',
            NOS: 'NO'
        }
        return team_abbrev[team] || team
    }

    if (player.position === 'RDP') {
        return player.playerName.slice(0, -2)
    } else {

        const players_to_search = Object.keys(stateAllPlayers || {})
            .map(player_id => {
                let match_score = 0

                if (stateAllPlayers[player_id]?.active === true
                    && stateAllPlayers[player_id]?.position === player.position) {
                    match_score += 1
                }
                if (stateAllPlayers[player_id]?.college === player.college) {
                    match_score += 1
                }
                if (stateAllPlayers[player_id]?.number === player.number) {
                    match_score += 1
                }
                if ((stateAllPlayers[player_id]?.team || 'FA') === matchTeam(player.team)) {
                    match_score += 1
                }
                if (stateAllPlayers[player_id]?.years_exp === player.seasonsExperience || 0) {
                    match_score += 1
                }
                if (player.playerName.replace('III', '').replace('II', '').replace('Jr', '').trim().toLowerCase().replace(/[^a-z]/g, "") === stateAllPlayers[player_id]?.search_full_name?.trim()) {
                    match_score += 5
                }

                return {
                    player_id: player_id,
                    match_score: match_score
                }
            })
            .sort((a, b) => b.match_score - a.match_score)

        return players_to_search[0].player_id


    }

}

exports.updateHistorical = async (app) => {
    /*
        setTimeout(async () => {
            console.log('Updating dynasty values')
            const stateAllPlayers = app.get('allplayers')
            app.set('syncing', 'true')
            const rankings = await getValue()
    
            const historical_rankings = await getHistorcalValues(rankings)
            const rankings_array = []
            Object.keys(historical_rankings.rankings).map(date => {
                return rankings_array.push({
                    date: new Date(date).toISOString().split('T')[0],
                    values: historical_rankings.rankings[date]
                })
            })
    
            const rankings_updated = []
            rankings_array.map(rankings_date => {
                const matched_date = matchRankingsWeek(rankings_date.date, rankings_date.values, stateAllPlayers)
                rankings_updated.push(matched_date)
            })
    
            try {
                await DynastyRankings.bulkCreate(rankings_updated, { updateOnDuplicate: ['values'] })
            } catch (error) {
                console.log(error)
            }
            app.set('syncing', 'false')
            console.log('Update complete')
        }, 5000)
    
    */
    setTimeout(async () => {
        app.set('syncing', 'true')
        console.log('Updating dynasty values')
        const ktc_historical = await axios.post('https://keeptradecut.com/dynasty-rankings/history')
        const stateAllPlayers = app.get('allplayers')
        const ktc_historical_dict = {}
        ktc_historical.data.map(ktc_player => {
            const sleeper_id = matchPlayer(ktc_player, stateAllPlayers)
            ktc_player.superflexValues.history.map(day => {
                if (!ktc_historical_dict[day.d]) {
                    ktc_historical_dict[day.d] = {}
                }

                if (!ktc_historical_dict[day.d][sleeper_id]) {
                    ktc_historical_dict[day.d][sleeper_id] = {}
                }

                ktc_historical_dict[day.d][sleeper_id]['sf'] = day.v
            })

            ktc_player.oneQBValues.history.map(day => {
                if (!ktc_historical_dict[day.d]) {
                    ktc_historical_dict[day.d] = {}
                }
                if (!ktc_historical_dict[day.d][sleeper_id]) {
                    ktc_historical_dict[day.d][sleeper_id] = {}
                }

                ktc_historical_dict[day.d][sleeper_id]['oneqb'] = day.v
            })
        })

        const rankings_array = []
        Object.keys(ktc_historical_dict).map(date => {
            return rankings_array.push({
                date: date,
                values: ktc_historical_dict[date]
            })
        })
        try {
            await DynastyRankings.bulkCreate(rankings_array, { updateOnDuplicate: ['values'] })
        } catch (error) {
            console.log(error)
        }
        app.set('syncing', 'false')
        console.log('Update complete')
    }, 5000)
}

exports.historical = async (app) => {



    setTimeout(async () => {
        app.set('syncing', 'true')
        const stateAllPlayers = app.get('allplayers')
        console.log('getting historical values')
        const rankings_all = await DynastyRankings.findAll({})

        const rankings_updated = []
        rankings_all.map(rankings_date => {
            const matched_date = matchRankingsWeek(rankings_date.dataValues.date, rankings_date.dataValues.values, stateAllPlayers)
            rankings_updated.push(matched_date)
        })

        try {
            await DynastyRankings.bulkCreate(rankings_updated, { updateOnDuplicate: ['values'] })
        } catch (error) {
            console.log(error)
        }

        app.set('syncing', 'false')
        console.log('historical values update complete')

    }, [3000])

}

exports.updateDaily = async (app) => {
    const date = new Date()
    const tzOffset = date.getTimezoneOffset()
    const tzOffset_ms = (tzOffset + 240) * 60 * 1000
    const date_tz = new Date(date + tzOffset_ms)
    const hour = date_tz.getHours()
    const minute = date_tz.getMinutes()

    const now = new Date(); // current date and time
    const midnightET = new Date(now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })); // midnight ET today
    const delay = ((60 - new Date().getMinutes()) * 60 * 1000);

    console.log(`next rankings update at ${new Date(new Date().getTime() - tzOffset_ms + delay)}`)
    setTimeout(async () => {
        console.log(`Beginning daily rankings update at ${new Date()}`)

        const stateAllPlayers = app.get('allplayers')
        const rankings_today = await getValue()


        const match_today = matchRankingsWeek(new Date(new Date().getTime() - (new Date().getTimezoneOffset() + 240) * 60000), rankings_today, stateAllPlayers)


        try {
            await DynastyRankings.upsert({
                date: new Date(new Date().getTime() - (new Date().getTimezoneOffset() + 240) * 60000).toISOString().split('T')[0],
                values: match_today.values

            })
        } catch (error) {
            console.log(error)
        }

        setInterval(async () => {
            app.set('syncing', 'true')
            console.log(`Beginning daily rankings update at ${new Date()}`)

            const stateAllPlayers = app.get('allplayers')
            const rankings_today = await getValue()


            const match_today = matchRankingsWeek(new Date(), rankings_today, stateAllPlayers)


            try {
                await DynastyRankings.upsert({
                    date: new Date(new Date().getTime() - (new Date().getTimezoneOffset() + 240) * 60000).toISOString().split('T')[0],
                    values: match_today.values

                })
            } catch (error) {
                console.log(error)
            }
            app.set('syncing', 'false')
            console.log(`Update Complete`)
        }, 1 * 60 * 60 * 1000)
    }, delay)
}