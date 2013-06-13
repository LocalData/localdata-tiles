/*jslint node: true */
'use strict';

var mongoose = require('mongoose');
// var util = require('../util');

var FormSchema = new mongoose.Schema({
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


FormSchema.set('toObject', {
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
FormSchema.statics.mostRecentForm = function mostRecentForm(surveyId, cb) {
  return this.find({survey: surveyId}).order('created', 1).limit(1).exec(cb);
};


FormSchema.statics.getFlattenedForm = function getFlattenedForm(surveyId, cb) {
  this.mostRecentForm(surveyId, function(error, doc){
    if (error) {
      cb(error);
      return;
    }

    var flattened = doc.flatten();
    console.log(flattened);
    cb(null, flattened);
  });
};

/**
 * Take a form and turn it into a flattened list of question objects
 * @return {Object} List of questions
 */
FormSchema.methods.flatten = function flatten() {
  console.log(this.model('Form'));

  var i;
  var question;
  var flattenedForm = [];
  var distinctQuestions = [];

  var form = this.model('Form');

  // Recursively flatten each of the questions
  for (i = 0; i < form.questions.length; i++) {
    question = form.questions[i];
    flattenedForm = flattenedForm.concat(flattenForm(question, flattenedForm));
  }

  // Make sure there's only one question per ID.
  var questionNames = [];
  for (i = 0; i < flattenedForm.length; i++) {
    question = flattenedForm[i];

    if (questionNames.indexOf(question.name) === -1) {
      questionNames.push(question.name);
      distinctQuestions.push(question);
    }
  }

  return distinctQuestions;
};


/**
 * Helper method used by the recursive getFlattenedForm
 * @param  {Object} question      Quesiton object
 * @param  {Array}  flattenedForm The flattened form so far
 * @return {Array}                The question added to the flattened form
 */
function flattenForm(question, flattenedForm) {

  // Add the question to the list of questions
  // Naive -- takes more space than needed (because it includes subquestions)
  flattenedForm.push(question);

  // Check if there are sub-questions associated with any of the answers
  for(var i = 0; i < question.answers.length; i++) {
    var answer = question.answers[i];

    if (answer.questions !== undefined) {
      for(var j = 0; j < answer.questions.length; j++) {
        var q = answer.questions[j];
        flattenedForm.push(flattenForm(q, flattenedForm));
      }
    }
  }

  return flattenedForm;
}


var Form = module.exports = mongoose.model('Form', FormSchema, 'formCollection');
