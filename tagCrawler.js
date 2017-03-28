'use strict'

var fs = require('fs');
const low = require('lowdb');
const sourceDb = low('final_db.json');
const db = low('fdb.json');
var async = require("async");
const json2xls = require('json2xls');
var confirmed = sourceDb.get('confirmed').value();
var unconfirmed = sourceDb.get('unconfirmed').value();
var failed = sourceDb.get('failed').value();
var final = [];

var request = require('request');
var cheerio = require('cheerio');
var URL = require('url-parse');
var natural = require('natural')
var TfIdf = natural.TfIdf;

var keyword_extractor = require("keyword-extractor");

//Get all confirmed with high confidence
confirmed.forEach(function (val) {
    if (val.confidenceLevel >= 0.5) {
        final.push({ name: val.name, sitz: val.city, url: val.url, plz: val.plz, strasse: val.strasse, hausenr: val.hausnr, vorstand: val.vorstand });
    }
});

//Get all unconfirmed with high confidence
unconfirmed.forEach(function (val) {
    if (val.confidenceLevels[0] >= 0.8) {
        final.push({ name: val.name, sitz: val.city, url: val.urls[0] });
    }
});

//Get all failed with high confidence
failed.forEach(function (val) {
    if (val.confidenceLevels[0] >= 0.8) {
        final.push({ name: val.name, sitz: val.city, url: val.urls[0] });
    }
});

function pruneKeywords(threshold, oldarray) {
    var newarray = [];
    oldarray.forEach(function (imp, i, array) {
        if (imp.relevance > threshold) {
            newarray.push({ text: imp.text, relevance: imp.relevance });
        }

    });
    return newarray;
};

var q = async.queue(function (url, cb) {
    var url = new URL(url);

    //console.log(url);
    // handling possible invlid URI error due to lack of protocol information
    if (!url.protocol) {
        url.protocol = 'http:';
        url.hostname = 'www.' + url.href;
    }
    var baseUrl = url.protocol + "//" + url.hostname;
    request(baseUrl, (error, response, body) => {
        if (error) {
            return cb(error);
        }
        // Check status code (200 is HTTP OK)
        if (response.statusCode !== 200) {
            return cb({ msg: "Status code NOT 200" }, null);
        }
        // Parse the document body
        var $ = cheerio.load(body);
        var keywords = $("meta[name='keywords']").attr("content");
        var importantWords = '';
        if (!keywords) {
            try {
                var paragraphs = $($.html()).find('p, h1, h2, h3, h4, h5, td, a, body, div');
                //Remove stop words and digits
                var extraction_result = keyword_extractor.extract(paragraphs.text(), {
                    language: "german",
                    return_changed_case: true,
                    remove_duplicates: false,
                    remove_digits: true

                });
                var modifiedText = '';
                extraction_result.forEach(function (keyword) {
                    if (!/darmstadt/i.test(keyword))
                        modifiedText += keyword + ' ';
                });
                var tfidf = new TfIdf();
                var importantWords = '';
                var count = 0;
                tfidf.addDocument(modifiedText);
                tfidf.listTerms(0).forEach(function (item) {
                    if (count <= 15) {
                        importantWords += item.term + ', ';
                        count++;
                    }
                });
            } catch (err) {
                importantWords = '';
            }
        } else {
            importantWords = keywords;
        }
        return cb(null, importantWords);
    });
}, 40);

q.drain = function () {
    var xls = json2xls(final);
    fs.writeFileSync('final.xlsx', xls, 'binary');
    console.log('Done!');
}

final.forEach(function (club) {
    q.push(club.url, function (err, tags) {
        if (err) {
            console.log('Something went wrong');
            console.log(err);
            club.tags = '';
        } else {
            console.log(tags);
            club.tags = tags;
        }
    });
});




