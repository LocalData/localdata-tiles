/*jslint node: true */
'use strict';

var mongoose = require('mongoose');
var __ = require('lodash');

// TODO: zones
var surveySchema = new mongoose.Schema({
  // We don't use the native mongo ID when communicating with clients.
  _id: { type: mongoose.Schema.Types.ObjectId, select: false },
  __v: { type: Number, select: false },
  id: String,
  name: { type: String, required: true },
  slug: String,
  // Survey type: null, which is equivalent to 'parcel'; 'point', or 'pointandparcel'
  type: {
    type: String
  },
  // Location of the survey (eg 'Detroit, MI')
  location: String,
  // For safety, exclude the users list by default.
  users: { type: [String], select: false },
  paperinfo: {
    type: {
      dpi: { type: Number, required: true },
      regmarks: [{ type: { type: Number, required: true }, bbox: {type: [Number], required: true } }],
      barcode: {
        bbox: { type: [Number], required: true }
      }
    },
    required: null
  },
  zones: {
    type: {
      type: String
    },
    features: []
  },
  exports: {
    type: {
      shapefile: {
        type: {
          requested: Date,
          url: String
        },
        required: false
      }
    },
    required: false,
    select: false
  }
}, {
  autoIndex: false
});

// Indexes

// Index the slug field.
surveySchema.index({ slug: 1 });

// Index the survey ID.
surveySchema.index({ id: 1 });

// Index the users
surveySchema.index({ users: 1 });

surveySchema.set('toObject', {
  transform: function (doc, ret, options) {
    return {
      id: ret.id,
      name: ret.name,
      users: ret.users,
      slug: ret.slug,
      type: ret.type,
      location: ret.location,
      paperinfo: ret.paperinfo,
      zones: ret.zones
    };
  }
});



/**
 * Return a survey if it is owned by the user.
 * @param  {String}  surveyId ID of the survey
 * @param  {String} userId
 * @param  {Function} callback params error, survey
 *                             error in format { code, message }
 */
 surveySchema.statics.findIfOwnedByUser = function (surveyId, userId, cb) {
  // Must include a userId parameter
  if(userId === undefined) {
    cb({code: 401, name: "UnauthorizedError", message: "No user specified"});
  }


  this.find({ id: surveyId }).select('+users').exec(function(error, surveys) {
    if (surveys.length === 0) {
      cb({code: 404, name: "SurveyNotFoundError", message: "Survey not found"});
      return;
    }

    if (surveys.length > 1) {
      cb({code: 500, name: "UnexpectedDataError", message: "Too many surveys found"});
      console.error("Error: multiple surveys with same ID");
      return;
    }

    var survey = surveys[0];

    if (__.contains(survey.users, userId)) {
      survey.users = undefined; // for security
      cb(null, survey);
      return;
    }

    cb({code: 403, name:"ForbiddenError", message: "Access denied"});
  });

};


var Survey = module.exports = mongoose.model('Survey', surveySchema, 'surveyCollection');
