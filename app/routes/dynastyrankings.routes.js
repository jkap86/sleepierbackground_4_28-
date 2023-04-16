'use strict'

module.exports = app => {
    const dynastyrankings = require("../controllers/dynastyrankings.controller.js");

    var router = require("express").Router();

    dynastyrankings.updateDaily(app)

    dynastyrankings.updateHistorical(app)

    //  dynastyrankings.historical(app)

    app.use('/dynastyrankings', router);
}