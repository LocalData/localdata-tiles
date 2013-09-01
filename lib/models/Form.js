/*jslint node: true */
'use strict';

var mongoose = require('mongoose');
// var util = require('../util');

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
formSchema.static('mostRecentForm', function (surveyId, callback) {
  return this.find({survey: surveyId}).sort({created: 'asc'}).limit(1).exec(callback);
});


/**
 * Get the most recent form for a survey and flatten it
 */
formSchema.static('getFlattenedForm', function(surveyId, callback) {
  this.mostRecentForm(surveyId, function(error, doc){
    if (error) {
      callback(error);
      return;
    }

    doc = doc[0];

    // TODO: not sure if returning an empty form is the best solution
    // I think we'll just give all objects the "undefined result" style
    if(!doc) {
      callback(null, []);
    }

    var flattened = doc.flatten();
    callback(null, flattened);
  });
});


/**
 * Take a form and turn it into a flattened list of question objects.
 * @return {Object} List of questions
 */
formSchema.method('flatten', function () {
  var i;
  var question;
  var flattenedForm = [];
  var distinctQuestions = [];

  // Recursively flatten each of the questions
  for (i = 0; i < this.questions.length; i++) {
    question = this.questions[i];
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
});


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

    // Add each checkbox answer as a separate question
    if (question.type === 'checkbox') {
      flattenedForm.push({
        name: answer.name,
        text: question.text + ': ' + answer.text
      });
    }

    if (answer.questions !== undefined) {
      for(var j = 0; j < answer.questions.length; j++) {
        var q = answer.questions[j];
        flattenedForm.push(flattenForm(q, flattenedForm));
      }
    }
  }

  return flattenedForm;
}


var Form = module.exports = mongoose.model('Form', formSchema, 'formCollection');
