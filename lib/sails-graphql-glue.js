/**
 * Sails - graphql
 *
 * @description :: a glue for express-graphql and sails framework.
 */

const Machine = require('machine');
const Promise = require('bluebird');
const _ = require('lodash');
const MockRes = require('mock-res');
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
      // sails.log.debug(action['friendlyName'], {params, results})
      return results;
    } catch(error) {
      // add code for easier debugging
      if (error.code) {
        error.message = `${error.code} - ${error.message}`
      }
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
  let serveOptions = {
    schema: makeExecutableSchema({typeDefs, resolvers}),
    graphiql: debug,
    pretty: debug,
    customFormatErrorFn: (e) => {
      const { locations, path } = e;
      const message = e.originalError['raw'] || e.message || defaultErrorMessage;
      const stack = e.stack && debug ? e.stack.split('\n') : [];

      // use flaverr({ code: ... }) ? oke lets go.
      let code = e.code || 'E_UNKNOWN_ERROR';
      if (message.substr(0, 2) == 'E_') {
        code = message.match('^(E_(.*)) - ')[1] || code;
      }

      return ({ locations, path, message, code, stack })
    }
  }

  const server = graphqlHTTP(serveOptions);

  // using mock-res to get the output first before passing into sails again,
  // because we want to use action-machine inputs validation to be able to response with bad request
  //
  // The reason with mock-res is because we still want to leverage the express-graphql module
  // rather than reinvent the wheel.
  return (req, res) => {
    var mockRes = new MockRes();
    server(req, mockRes)

    mockRes.on('finish', () => {
      const graphqlResponse = mockRes._getJSON();

      // check any errors,
      if (graphqlResponse.errors) {
        graphqlResponse.errors.forEach(error => {
          // if any invalid inputs
          if (error.code === 'E_INVALID_ARGINS') {
            res.statusCode = 400;
          }
        })
      }

      mockRes.pipe(res);
    })
  };
}

module.exports = {
  serve,
  actionAsResolver
};
