/**
 * Sails - graphql
 *
 * @description :: a glue for express-graphql and sails framework.
 */

const Machine = require('machine');
const Promise = require('bluebird');
const _ = require('lodash');
const flaverr = require('flaverr');
const MockRes = require('mock-res');
const graphqlHTTP = require('express-graphql');
const { makeExecutableSchema } = require('graphql-tools');

const defaultErrorMessage = "Unexpected error occurred!";

const createValidationMachine = ({friendlyName, originalInputs}) => {
  let validationInputs = _.cloneDeep(originalInputs);

  // validationInputs without custom validation
  Object.keys(validationInputs).forEach(argName => {
    if (validationInputs[argName].custom) {
      delete validationInputs[argName].custom;
    }
  })

  const validationMachine = Machine({
    friendlyName,
    inputs: validationInputs,
    exits: {},
    fn: (_, exits) => {
      sails.sdk.log.trace({
        machine: friendlyName,
        validation: 'ok',
      })
      return exits.success();
    }
  });

  return validationMachine;
}

const createSimplifiedInputs = ({ originalInputs }) => {
  let simplifiedInputs = {};

  Object.keys(originalInputs).forEach(argName => {
    simplifiedInputs[argName] = {
      required: originalInputs[argName].required || false,
      type: originalInputs[argName].type || 'ref',
    };
  })

  return simplifiedInputs;
}

const validateCustoms = ({inputs, args}) => {
  return Promise.all(Object.keys(inputs).map(argName => {
    if (inputs[argName]) {
      if (typeof inputs[argName].custom === 'function' &&
          inputs[argName].required
      ) {
        return Promise.resolve(inputs[argName].custom(args[argName]))
          .then(result => {
            if (!result) {
              throw new Error(`${argName} is fail to pass validation!`);
            }
          })
      }
    }
  }))
}

const actionAsResolver = (action) => {
  let originalInputs = action['inputs'] || {};

  const validationMachine = createValidationMachine({
    friendlyName: `${action.friendlyName}/inputs-validation`,
    originalInputs,
  })

    // join exists parameters
  let exits = _.assign({
    success: {
      description: "done."
    },
    error: {
      description: defaultErrorMessage
    }
  }, action['exists'] || {});

  // because resolver is (parent, args, context, info) => ...
  let inputs = _.assign({
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
  }, createSimplifiedInputs({ originalInputs }));

  // make parent => $parent, to make it compatible with machine inputs
  return async (parent, args, context, info) => {
    args = {...args, email: 'aaa'};

    // validations
    await validationMachine(args)
      .catch(err => {
        errorMessage = `E_INVALID_ARGINS - ${err.problems.join("\n")}`;
        throw flaverr({ code: 'E_INVALID_ARGINS' }, new Error(errorMessage))
      });

    // custom function validations
    await validateCustoms({ inputs: originalInputs, args })
      .catch(err => {
        errorMessage = `E_INVALID_ARGINS - ${err.message}`;
        throw flaverr({ code: 'E_INVALID_ARGINS' }, new Error(errorMessage))
      });

    // simulate
    let fn = action.fn.bind({req: context});
    let callable = Machine({
      friendlyName: action['friendlyName'] || {},
      description: action['description'] || {},
      inputs,
      exits,
      fn: (inputsRuntime, existsRuntime) => {
        return Promise.resolve(fn(inputsRuntime))
          .then(r => existsRuntime.success(r))
          .catch(e => existsRuntime.error(e))
      }
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
      let message = e.message || defaultErrorMessage;
      const stack = e.stack && debug ? e.stack.split('\n') : [];

      // use flaverr({ code: ... }) ? oke lets go.
      let code = e.code || 'E_UNKNOWN_ERROR';
      if (message.substr(0, 2) == 'E_') {
        code = message.match('^(E_(.*)) - ')[1] || code;
        message = message.substr(code.length + 3);
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
    // default
    res.status(200);

    let mockRes = new MockRes();
    server(req, mockRes)

    mockRes.on('finish', () => {
      try {
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
      } catch(err) {}
      mockRes.pipe(res);
    })
  };
}

module.exports = {
  serve,
  actionAsResolver
};
