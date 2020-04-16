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
const NoIntrospection = require('graphql-disable-introspection');

const defaultErrorMessage = 'Unexpected error occurred!';

const createValidationMachine = ({ friendlyName, originalInputs }) => {
  const validationInputs = _.cloneDeep(originalInputs);

  // validationInputs without custom validation
  Object.keys(validationInputs).forEach((argName) => {
    if (validationInputs[argName].custom) {
      delete validationInputs[argName].custom;
    }
  });

  const validationMachine = Machine({
    friendlyName,
    inputs: validationInputs,
    exits: {},
    fn: (_, exits) => {
      sails.sdk.log.trace({
        machine: friendlyName,
        validation: 'ok',
      });
      return exits.success();
    },
  });

  return validationMachine;
};

const createSimplifiedInputs = ({ originalInputs }) => {
  const simplifiedInputs = {};

  Object.keys(originalInputs).forEach((argName) => {
    simplifiedInputs[argName] = {
      required: originalInputs[argName].required || false,
      type: originalInputs[argName].type || 'ref',
      defaultsTo: originalInputs[argName].defaultsTo,
    };
  });

  return simplifiedInputs;
};

const validateCustoms = ({ inputs, args }) => Promise.all(Object.keys(inputs).map((argName) => {
  if (inputs[argName]
      && args[argName]
      && typeof inputs[argName].custom === 'function'
  ) {
    return Promise.resolve(inputs[argName].custom(args[argName]))
      .then((result) => {
        if (!result) {
          throw new Error(`${argName} is fail to pass validation!`);
        }
      });
  }
}));

const actionAsResolver = (action) => {
  const originalInputs = action.inputs || {};

  const validationMachine = createValidationMachine({
    friendlyName: `${action.friendlyName}/inputs-validation`,
    originalInputs,
  });

  // join exists parameters
  const exits = _.assign({
    success: {
      description: 'done.',
    },
    error: {
      description: defaultErrorMessage,
    },
  }, action.exists || {});

  // because resolver is (parent, args, context, info) => ...
  const inputs = _.assign({
    $parent: {
      description: 'parent',
      type: 'ref',
      defaultsTo: {},
    },
    $context: {
      description: 'context',
      type: 'ref',
      defaultsTo: {},
    },
    $info: {
      description: 'info',
      type: 'ref',
      defaultsTo: {},
    },
  }, createSimplifiedInputs({ originalInputs }));

  // make parent => $parent, to make it compatible with machine inputs
  return async (parent, args, context, info) => {
    // validations
    await validationMachine(args)
      .catch((err) => {
        errorMessage = `E_INVALID_ARGINS - ${err.problems.join('\n')}`;
        throw flaverr({ code: 'E_INVALID_ARGINS' }, new Error(errorMessage));
      });

    // custom function validations
    await validateCustoms({ inputs: originalInputs, args })
      .catch((err) => {
        errorMessage = `E_INVALID_ARGINS - ${err.message}`;
        throw flaverr({ code: 'E_INVALID_ARGINS' }, new Error(errorMessage));
      });

    // simulate
    const fn = action.fn.bind({ req: context });
    const callable = Machine({
      friendlyName: action.friendlyName || {},
      description: action.description || {},
      inputs,
      exits,
      fn: (inputsRuntime, existsRuntime) => Promise.resolve(fn(inputsRuntime))
        .then((r) => existsRuntime.success(r))
        .catch((e) => existsRuntime.error(e)),
    });

    // call
    const params = _.assign({ $parent: parent, $context: context, $info: info }, args);
    try {
      const results = await callable(params);
      // sails.log.debug(action['friendlyName'], {params, results})
      return results;
    } catch (error) {
      // add code for easier debugging
      if (error.code) {
        error.message = `${error.code} - ${error.message}`;
      }

      // simplify error message
      const paramsError = {
        code: error.code || 'E_UNKNOWN_ERROR',
        message: error.message,
        req: {
          url: params.$context.url,
          method: params.$context.method,
          headers: JSON.stringify(params.$context.headers)
        },
        graphql: typeof params.$context.body === 'object'
          ? _.pick(params.$context.body, ['query', 'variables'])
          : params.$context.body
      }

      if (error.code === 'E_INVALID_ARGINS') {
        sails.log.silly(action.friendlyName, paramsError);
      } else {
        sails.log.error(action.friendlyName, paramsError);
      }
      throw error;
    }
  };
};

const serve = ({
  typeDefs,
  resolvers,
  debug = false,
}) => {
  const serveOptions = {
    schema: makeExecutableSchema({ typeDefs, resolvers }),
    graphiql: debug,
    pretty: debug,
    validationRules: debug ? undefined : [NoIntrospection],
    customFormatErrorFn: (e) => {
      let httpStatusCode = 500;
      const { locations, path } = e;
      let message = e.message || defaultErrorMessage;
      const stack = e.stack && debug ? e.stack.split('\n') : [];

      // schema invalid
      if (message.match(/Expected type/g) !== null) {
        httpStatusCode = 400;
        e.code = 'E_INVALID_ARGINS';
      }

      // use flaverr({ code: ... }) ? oke lets go.
      let code = e.code || 'E_UNKNOWN_ERROR';
      if (message.substr(0, 2) == 'E_') {
        code = message.match('^(E_(.*)) - ')[1] || code;
        const errorCode400 = ['E_INVALID_ARGINS', 'E_NOT_UNIQUE'];
        if (errorCode400.indexOf(code) !== -1) {
          httpStatusCode = 400;
        }
        message = message.substr(code.length + 3);
      }

      return ({
        locations, path, message, code, httpStatusCode, stack,
      });
    },
  };

  const server = graphqlHTTP(serveOptions);

  // using mock-res to get the output first before passing into sails again,
  // because we want to use action-machine inputs validation to be able to response with bad request
  //
  // The reason with mock-res is because we still want to leverage the express-graphql module
  // rather than reinvent the wheel.
  return (req, res) => {
    // default
    res.status(200);

    const mockRes = new MockRes();
    server(req, mockRes);

    mockRes.on('finish', () => {

      // patch for 400 error
      if (mockRes.statusCode === 400) {
        let response = (mockRes._getJSON())
        if (response.errors[0]) {
          response.errors[0].httpStatusCode = 400;
        }
        res.status(200);
        res.send(response)
        return;
      }

      res.status(200);
      mockRes.pipe(res);
    });
  };
};

module.exports = {
  serve,
  actionAsResolver,
};
