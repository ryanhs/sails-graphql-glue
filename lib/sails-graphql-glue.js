/**
 * Sails - graphql
 *
 * @description :: a glue for express-graphql and sails framework.
 */

var Machine = require('machine');
var Promise = require('bluebird');
var _ = require('lodash');

const graphqlHTTP = require('express-graphql');
const {makeExecutableSchema} = require('graphql-tools');

const defaultErrorMessage = "Unexpected error occurred!";

const actionAsResolver = (action) => {
  var exits = _.assign({
    success: {
      description: "done."
    },
    error: {
      description: defaultErrorMessage
    }
  }, action['exists'] || {});

  // simulate
  var callable = Machine({
    friendlyName: action['friendlyName'] || {},
    description: action['description'] || {},
    inputs: action['inputs'] || {},
    exits,
    fn: (inputs, exists) => Promise.resolve(action.fn(inputs)).then(r => exists.success(r)).catch(e => exists.error(e))
  })

  return async (parent, inputs) => callable(inputs)
}

const serve = ({
  typeDefs,
  resolvers,
  debug = true
}) => {
  var serveOptions = {
    schema: makeExecutableSchema({typeDefs, resolvers}),
    graphiql: debug,
    pretty: debug
  }

  if (!debug) {
    serveOptions.customFormatErrorFn = (e) => ({
      locations: e.locations,
      path: e.path,
      message: e.originalError['raw'] || defaultErrorMessage
    });
  }

  return graphqlHTTP(serveOptions);
}

module.exports = {
  serve,
  actionAsResolver
};
