'use strict'
const db = require("../models");
const DynastyRankings = db.dynastyrankings;
const Stats = db.stats;
const puppeteer = require('puppeteer');
const cheerio = require('cheerio')
const https = require('https');
const axios = require('axios').create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
    timeout: 7000
});
const axiosRetry = require('axios-retry');
const ALLPLAYERS = require('../../allplayers.json');
const fs = require('fs');

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
async function wait(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}
const getHistorcalValues = async (players, superflex) => {

    let elements = {}
    const unmatched = {}
    for (const player of Object.keys(players).slice(0, 5)) {
        console.log('Begin ' + players[player].name + ' at ' + new Date().toLocaleTimeString())
        const browser = await puppeteer.launch();
        let html;
        const page = await browser.newPage();

        page.setDefaultTimeout(15000)

        const getPlayerValues = async () => {
            await page.goto('https://keeptradecut.com/' + players[player].link);

            const interval = setInterval(async () => {
                try {

                    const modal = await page.$('span#dont-know');
                    if (modal) {
                        await modal.click();
                    }
                } catch (err) {



                }
            }, 1000)

            await page.$('div.sidebar div.sf-toggle-wrapper')

            await page.$eval('div.sidebar div.sf-toggle-wrapper', (element) => {
                element.classList.remove('superflex');
                element.classList.add('oneqb');
            });

            const alltime = await page.$('#pd-value-graph #all-time');

            await alltime.click()

            await page.$eval('#pd-value-graph #all-time', (element) => {
                element.classList.add('active')
            })


            const data = await page.$('#pd-value-graph div#all-time.active')
            await wait(3000)
            if (data) {
                html = await page.content();
            }

            return html
        }

        while (!html) {
            try {



                html = await getPlayerValues()

            } catch (error) {

                console.log(players[player].name)



            }
        }



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
        console.log('End ' + players[player].name + ' at ' + new Date().toLocaleTimeString())
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
                if (player.playerName?.replace('III', '').replace('II', '').replace('Jr', '').trim().toLowerCase().replace(/[^a-z]/g, "") === stateAllPlayers[player_id]?.search_full_name?.trim()) {
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
    const getDailyValues = async () => {
        app.set('syncing', 'true')
        console.log(`Beginning daily rankings update at ${new Date()}`)

        const stateAllPlayers = app.get('allplayers')
        const ktc = await axios.post('https://keeptradecut.com/dynasty-rankings/history')

        const daily_values = {}

        const missing = {}



        ktc.data.map(ktc_player => {
            const sleeper_id = matchPlayer(ktc_player, stateAllPlayers)
            daily_values[sleeper_id] = {
                oneqb: ktc_player.oneQBValues.value,
                sf: ktc_player.superflexValues.value
            }

            missing[sleeper_id] = {
                oneqb: ktc_player.oneQBValues.history[ktc_player.superflexValues.history.length - 3]?.v,
                sf: ktc_player.superflexValues.history[ktc_player.superflexValues.history.length - 3]?.v
            }

        })

        try {
            await DynastyRankings.upsert({
                date: new Date(new Date().getTime()),
                values: daily_values
            })

            await DynastyRankings.upsert({
                date: new Date(new Date().getTime() - 24 * 60 * 60 * 1000),
                values: missing
            })
        } catch (error) {
            console.log(error)
        }
        app.set('syncing', 'false')
        console.log(`Update Complete`)
    }



    const eastern_time = new Date(new Date().getTime() - 240 * 60 * 1000)

    const delay = ((60 - new Date(eastern_time).getMinutes()) * 60 * 1000);

    console.log(`next rankings update at ${delay / 60000} min`)
    setTimeout(async () => {

        await getDailyValues()

        setInterval(async () => {
            await getDailyValues()
        }, 1 * 60 * 60 * 1000)

    }, 5000)
}

exports.alltime = async (app) => {
    /*
    const current_values = await getValue()

    fs.writeFile('current_values.json', JSON.stringify(current_values), (err) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log('Current values written to current_values.json');
    });
    




    const current_values = require('../../current_values.json');

    const alltime_values = await getHistorcalValues(current_values, false)

    fs.writeFile('alltime_values_oneqb.json', JSON.stringify(alltime_values), (err) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log('All time values written to alltime_values_oneqb.json');
    });

  
        setTimeout(() => {
            const stateAllPlayers = app.get('allplayers')
            const alltime_values = require('../../alltime_values.json');
    
            const alltime_dict = {}
    
            Object.keys(alltime_values.rankings).map(date => {
                const date_values = {}
                if (!alltime_dict[date]) {
                    alltime_dict[date] = {}
                }
                Object.keys(alltime_values.rankings[date]).map(link => {
                    const player_id = matchPlayer(alltime_values.rankings[date][link] || {}, stateAllPlayers)
                    if (!alltime_dict[date][player_id]) {
                        alltime_dict[date][player_id] = []
                    }
    
                    alltime_dict[date][player_id].push(alltime_values.rankings[date][link])
    
                })
                console.log(`${date} rankings added`)
            })
            fs.writeFile('alltime_dict.json', JSON.stringify(alltime_dict), (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log('alltime_values.json values written to alltime_dict.json');
            });
        }, 5000)
    
  
        const alltime = require('../../alltime_dict.json');
    
        const alltime_array = []
    
        Object.keys(alltime).map(date => {
            let values = {}
    
            Object.keys(alltime[date])
                .map(player_id => {
                    values[player_id] = alltime[date][player_id][0]
                })
    
            return alltime_array.push({
                date: new Date(date),
                values: values
            })
        })
    
        await DynastyRankings.bulkCreate(alltime_array, { ignoreDuplicates: true })
      */

    app.set('syncing', 'true')
    const alltime = require('../../alltime_dict.json');

    let values = {}


    for (const player_id of Object.keys(alltime["2023-04-15"])) {
        const getValues = async () => {
            const link = 'https://keeptradecut.com/' + alltime["2023-04-15"][player_id][0].link
            const source_code = await axios.get(link)

            let $ = cheerio.load(source_code.data)

            const scriptTag = $('script').filter(function () {
                return $(this).html().includes('var playerSuperflex');
            })


            // Extract the value assigned to the playerSuperflex variable
            const superflexValues = scriptTag.text().match(/var playerSuperflex = (.+);/)[1];
            const oneQBValues = scriptTag.text().match(/var playerOneQB = (.+);/)[1];

            // Parse the JSON-formatted data to a JavaScript object
            const superflexData = JSON.parse(superflexValues);
            const oneQBData = JSON.parse(oneQBValues)

            return {
                sf: Object.values(superflexData.overallValue),
                oneQB: Object.values(oneQBData.overallValue)
            }
        }

        const player_values_history = await getValues()

        player_values_history.sf.map(value_date_object => {
            if (!values[value_date_object.d]) {
                values[value_date_object.d] = {}
            }

            if (!values[value_date_object.d][player_id]) {
                values[value_date_object.d][player_id] = {}
            }

            values[value_date_object.d][player_id].sf = value_date_object.v
        })

        player_values_history.oneQB.map(value_date_object => {
            if (!values[value_date_object.d]) {
                values[value_date_object.d] = {}
            }

            if (!values[value_date_object.d][player_id]) {
                values[value_date_object.d][player_id] = {}
            }

            values[value_date_object.d][player_id].oneqb = value_date_object.v
        })
        console.log(`Values fetched for ${player_id} `)
    }

    const values_array = []

    Object.keys(values).map(date => {
        return values_array.push({
            date: new Date(new Date(date).getTime()),
            values: values[date]
        })
    })
    await DynastyRankings.bulkCreate(values_array, { updateOnDuplicate: ['date', 'values'] })
    app.set('syncing', 'false')
}

exports.uploadStats = async (app) => {

    const stats = []
    for (let season = 2009; season < 2023; season++) {
        const num_weeks = season < 2022 ? 16 : 17

        for (let week = 1; week <= num_weeks; week++) {
            const weekly_stats = require(`../../NFL Weekly Stats 2009-2022/${season}_Week${week}_Stats.json`)

            weekly_stats.map(stats_object => {
                return stats.push({
                    season: stats_object.season,
                    week: stats_object.week,
                    player_id: stats_object.player_id,
                    team: stats_object.team,
                    opponent: stats_object.opponent,
                    stats: stats_object.stats,
                    date: stats_object.date
                })
            })
        }

    }

    try {
        await Stats.bulkCreate(stats, { ignoreDuplicates: true })
    } catch (err) {
        console.log(err.message)
    }

}