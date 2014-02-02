/*jslint node: true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var settings = require('../settings');

var NOANSWER = settings.noAnswer;

var formSchema = new mongoose.Schema({
  // We don't use the native mongo ID when communicating with clients.
  _id: { type: mongoose.Schema.Types.ObjectId, select: false },
  __v: { type: Number, select: false },
  id: String,
  survey: String,
  created: Date,
  type: { type: String },
  questions: [], // Used by mobile forms
  global: {}, // Used by paper forms
  parcels: [] // Used by paper forms
});



formSchema.set('toObject', {
  transform: function (doc, ret, options) {
    var obj = {
      id: ret.id,
      survey: ret.survey,
      created: ret.created,
      type: ret.type
    };

    if (ret.type === 'mobile') {
      obj.questions = ret.questions;
    } else if (ret.type === 'paper') {
      obj.global = ret.global;
      obj.parcels = ret.parcels;
    }

    return obj;
  }
});


/**
 * Get the most recent form for a survey
 */
formSchema.static('getLatest', function (surveyId, done) {
  return this.find({survey: surveyId})
  .sort({created: 'desc'})
  .limit(1)
  .exec(function (error, docs) {
    if (error) {
      done(error);
      return;
    }

    if (!docs || docs.length === 0) {
      done(null, null);
      return;
    }

    done(null, docs[0]);
  });
});


/**
 * Take a form and turn it into a flattened object of question names mapping to
 * arrays of answer values.
 * @return {Object} question-answer values mapping
 */
formSchema.method('getKeyValues', function () {
  var result = {};

  function flattenHelper(question) {
    var name = question.name;
    var answerSlugs = _.pluck(question.answers, 'value');
    answerSlugs.push(NOANSWER);
    if (result[name] === undefined) {
      result[name] = answerSlugs;
    } else {
      // The question name is not unique.
      var i = 1;
      while (result[name + '-' + i] !== undefined) {
        i += 1;
      }
      result[name + '-' + i] = answerSlugs;
    }
    question.answers.forEach(function (answer) {
      if (answer.questions) {
        answer.questions.forEach(flattenHelper);
      }
    });
  }

  this.questions.forEach(flattenHelper);

  return result;
});

var Form = module.exports = mongoose.model('Form', formSchema, 'formCollection');
