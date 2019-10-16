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

  // because resolver is (parent, args, context, info) => ...
  var inputs = _.assign({
    "$parent": {
      description: "parent",
      type: 'ref',
      defaultsTo: {},
    },
    "$context": {
      description: "context",
      type: 'ref',
      defaultsTo: {},
    },
    "$info": {
      description: "info",
      type: 'ref',
      defaultsTo: {},
    },
  }, action['inputs'] || {});

  // make parent => $parent, to make it compatible with machine inputs
  return async (parent, args, context, info) => {
    // simulate
    var fn = action.fn.bind({req: context});
    var callable = Machine({
      friendlyName: action['friendlyName'] || {},
      description: action['description'] || {},
      inputs,
      exits,
      fn: (inputs, exists) => Promise.resolve(fn(inputs)).then(r => exists.success(r)).catch(e => exists.error(e))
    })

    // call
    let params = _.assign({$parent: parent, $context: context, $info: info}, args);
    try {
      let results = await callable(params);
      sails.log.debug(action['friendlyName'], {params, results})
      return results;
    } catch(error) {
      sails.log.error(action['friendlyName'], {params, error})
      throw error
    }
  }
}

const serve = ({
  typeDefs,
  resolvers,
  debug = false
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
