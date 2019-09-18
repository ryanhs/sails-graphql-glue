# Sails Graphql Glue

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


### actionAsResolver()

This function is to wrap sails action2 into a resolver. so you can use your current action freely.
Example: `actionAsResolver(require('./api/hello'))`

### serve()

this function is to glue express-graphql into sails compatible.

#### parameters

- typeDefs `graphql schema`
- resolvers `root resolvers`
- debug `just to make sure json pretty print, GraphiQL, and full error reporting`


### License

hmm currently WTFPL
