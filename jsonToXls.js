'use strict'
var fs = require('fs');
const low = require('lowdb');
const json2xls = require('json2xls');
const db = low('final_db.json');
var confirmed = db.get('confirmed').value();
var unconfirmed = db.get('unconfirmed').value();
var failed = db.get('failed').value();
var final = [];

confirmed.forEach(function (val) {
    if (val.confidenceLevel >= 0.5) {
        final.push({name: val.name, sitz: val.city, url: val.url, plz: val.plz, strasse: val.strasse, hausenr: val.hausnr, vorstand: val.vorstand });
    }
});
unconfirmed.forEach(function (val) {
    if (val.confidenceLevels[0] >= 0.8) {
        final.push({name: val.name, sitz: val.city, url: val.urls[0] });
    }
});
failed.forEach(function (val) {
    if (val.confidenceLevels[0] >= 0.8) {
        final.push({name: val.name, sitz: val.city, url: val.urls[0] });
    }
});

var xls = json2xls(final);
fs.writeFileSync('data.xlsx', xls, 'binary');