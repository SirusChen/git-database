import path from 'path';
import express from 'express';
import routes from './routes';

const app = express();
const port = process.env.PORT || 3001;

app.set('views', path.resolve('src', 'views'));
app.set('view engine', 'ejs');

app.use('/static', express.static(path.resolve('src', 'static')));

app.use(express.json())

routes.forEach((route) => {
  app.use('/', route);
})

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;
