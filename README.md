# Sails Graphql Glue

[![npm version](https://badge.fury.io/js/sails-graphql-glue.svg)](https://badge.fury.io/js/sails-graphql-glue)  [![Coverage Status](https://coveralls.io/repos/github/ryanhs/sails-graphql-glue/badge.svg?branch=master)](https://coveralls.io/github/ryanhs/sails-graphql-glue?branch=master)  ![node](https://img.shields.io/node/v/sails-graphql-glue)  ![npm bundle size](https://img.shields.io/bundlephobia/min/sails-graphql-glue)

this package is intended to make a glue for `express-graphql` and `sails` framework.

### Installation

to install is just straight forward:

- with npm: `npm i sails-graphql-glue`
- with yarn: `yarn add sails-graphql-glue`


### Example Graphql Action

ON *api/controllers/graphql.js*:

```javascript
/* api/controllers/graphql.js */

var Promise = require('bluebird');
const { actionAsResolver, serve } = require('sails-graphql-glue');

const typeDefs = `
  type Query {
    hello: String!
    helloName(name: String): String!
  }

  schema {
    query: Query
  }
`

const resolvers = {
  Query: {
    hello: async () => Promise.resolve('hello world!'),
    helloName: actionAsResolver(require('./api/hello')),
  }
}

module.exports = serve({typeDefs, resolvers, debug: sails.config.environment === 'development'});
```

ON *config/routes.js* add the graphql route:

```javascript
module.exports.routes = {
  ...

  '/graphql': { action: 'graphql' }
};

```


### Func: actionAsResolver()

This function is to wrap sails action2 into a resolver. so you can use your current action freely.
Example: `actionAsResolver(require('./api/hello'))`

### Func: serve()

this function is to glue express-graphql into sails compatible.

###### + parameters

- typeDefs `graphql schema`
- resolvers `root resolvers`
- debug `just to make sure json pretty print, GraphiQL, and full error reporting`


### Resolver (parent, context, info)

A Resolver in graphql have this common format:
`(parent, args, context, info) => ...`

therefore, to make it compatible with machine inputs,
the parameters changed into `$parent`, `$context`, `$info`. parameters from `arg` extracted into normal machine `inputs`.

```javascript
// automatically added into action/machine inputs
{
  "$parent": {
    description: "parent",
    type: 'ref',
    defaultsTo: null,
  },
  "$context": {
    description: "context",
    type: 'ref',
    defaultsTo: null,
  },
  "$info": {
    description: "info",
    type: 'ref',
    defaultsTo: null,
  },
}
```

you can use context (req), as example:

```javascript
fn: async ({ $context, name = "test" }) => {
  console.log(Object.keys($context));
  return name
}
```

### License

MIT
