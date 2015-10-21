'use strict';

var Promise = require('bluebird');

var CacheItem = require('./models/CacheItem');
var Form = require('./models/Form');
var settings = require('./settings');
var themes = require('./themes');

Promise.promisifyAll(Form);

var CACHE_NAME = 'tile-layerDefs-' + settings.name;

// Used for legacy layer definitions.
var NOANSWER = settings.noAnswer;
var ANSWER = settings.unstructuredAnswer;
var colors = [
  "#b7aba5", // First color used for blank entries
             // Actually set in the style template
  "#a743c3",
  "#f15a24",
  "#58aeff",
  "#00ad00",
  "#ffad00",
  "#6e6663", // dark gray
  "#0049ad"  // dark blue
];

exports.saveDefinition = function saveDefinition(layerId, layerDefinition) {
  // XXX Adjust the select/query specifications to refer to properties that
  // are under entries rather than the top-level properties field.

  // We store JSON strings, since we're essentially treating the fields as
  // atomic units (whose fields might have invalid mongodb field names) rather
  // than subdocuments.
  var query = JSON.stringify(layerDefinition.query);
  var select = JSON.stringify(layerDefinition.select);

  //  survey: String,
  //  humanReadableName: String,
  //  object_id: { type: String },
  //  centroid: []
  return Promise.try(function () {
    return CacheItem.findOneAndUpdateAsync({
      _id: {
        cache: CACHE_NAME,
        key: layerId
      }
    }, {
      $set: {
        accessed: new Date(),
        contents: {
          query: query,
          select: select,
          styles: layerDefinition.styles
        }
      }
    }, {
      new: true,
      upsert: true,
      select: { _id: 1 }
    });
  });
};

exports.getDefinition = function (options) {
  if (!options.layerId && options.key) {
    // Legacy coloration/filter specification
    return exports.getLegacyLayer({
      key: options.key,
      val: options.val,
      surveyId: options.surveyId,
      grid: options.grid
    });
  }

  return Promise.try(function () {
    if (options.layerId) {
      return CacheItem.findOneAndUpdateAsync({
        _id: {
          cache: CACHE_NAME,
          key: options.layerId
        }
      }, {
        $set: {
          accessed: new Date()
        }
      }, {
        new: true
      }).then(function (item) {
        if (item) {
          return {
            query: JSON.parse(item.contents.query),
            select: JSON.parse(item.contents.select),
            styles: item.contents.styles
          };
        }
      });
    }

    return {
      query: {},
      select: {},
      styles: themes.coverage
    };
  });
};


// Returns a promise for the layer definition.
// Implements the legacy behavior of creating styles based on a specified
// key or key/value.
exports.getLegacyLayer = function getLegacyLayer(options) {
  var key = options.key;
  var val = options.val;
  var surveyId = options.surveyId;
  var grid = options.grid;

  if (key === 'Collector') {
    return Promise.resolve({
      styles: themes.render.filter({ options: [] }),
      select: {
        'entries.source.collector': 1
      },
      query: {}
    });
  }

  return Form.getLatestAsync(surveyId)
  .then(function (form) {
    var query = {};
    var select = {};
    var theme;

    var questions;
    if (form) {
      questions = form.flatten();
    } else {
      questions = {};
    }

    // Support reviewed questions
    // A question's review status is not explicitly part of the form,
    // but the field is stored as though it's a regular response
    questions.reviewed = {
      answers: ['flagged', 'accepted', 'no response']
    };

    // Get the question type, if there is one.
    var type;
    if (questions[key] !== undefined) {
      type = questions[key].type;
    }

    var answers;
    var styles;
    var path;

    // We don't need coloration for the UTF grids
    if (grid) {
      theme = themes.coverage;
    }

    if (type === 'file') {
      // For file filters, we just need to know if the answer exists or not.
      // Use the 'file' field instead of the 'responses' field.
      select['entries.files'] = 1;

      if (val === ANSWER) {
        query['entries.files.0'] = { $exists: true };
      } else if (val === NOANSWER) {
        query['entries.files.0'] = { $exists: false };
      }

      if (!grid) {
        // Color based on "yes there's a file" vs "no there isn't".
        theme = themes.render.presence({
          key: 'files'
        });
      }

    } else if (type === 'text') {
      // Check for text responses.
      // Like files, we just need to know if the question has been answered
      // or not.
      path = 'entries.responses.' + key;
      select[path] = 1;

      if (val === ANSWER) {
        query[path] = { $exists: true };
      } else if (val === NOANSWER) {
        query[path] = { $exists: false };
      }

      if (!grid) {
        // Color based on "yes there's a text response" vs "no there isn't".
        // Color based on "yes there's a file" vs "no there isn't".
        theme = themes.render.presence({
          key: 'responses.' + key
        });
      }

    } else {
      // Create styles and filters for all other questions
      path = 'entries.responses.' + key;
      select[path] = 1;

      if (val !== undefined) {
        query[path] = val;
        if (val === NOANSWER) {
          query[path] = { $exists: false };
        }
      }

      if (!grid) { // we don't need styles for UTF grids
        // If we're asked to filter on questions that don't exist, handle it
        // gracefully.
        if (questions[key] === undefined) {
          answers = [];
        } else {
          answers = questions[key].answers;
        }

        if (!answers) {
          answers = [NOANSWER];
        }

        styles = [];
        var i;
         // If we are querying for a key-value pair, we'll only need one color.
        var filterColor;
        if (val !== undefined) {
          for (i = 0; i < answers.length; i += 1) {
            if (answers[i] === val) {
              filterColor = colors[i + 1];
            }
          }
        }

        for (i = 0; i < answers.length; i += 1) {
          // Assign a color to each answer.
          var s = {
            key: 'responses.' + key,
            value: answers[i],
             // If we are querying a key-value pair, assign every question
            // the same color to prevent miscolored answers. Otherwise,
            // assign it the correct color.
            // Makes up for a defficiency in our queries where returned results
            // might not have the desired answer.
            // TODO: not use a hack to solve this.
            color: filterColor || colors[i + 1]
          };
          if (answers[i] === NOANSWER) {
            s.color = colors[0];
          }
          styles[i] = s;
        }

        // Render the filter style template
        theme = themes.render.filter({ options: styles });
      }
    }
    return {
      query: query,
      select: select,
      styles: theme
    };
  });
};
