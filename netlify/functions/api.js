const serverless = require('serverless-http');

const { app, ensureDbInitialized } = require('../../server');

const appHandler = serverless(app);

exports.handler = async function (event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  await ensureDbInitialized();
  return appHandler(event, context);
};
