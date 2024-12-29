import { Router } from 'express';
import dataRouter from './database';

const indexRouter = Router().get('/', (req, res) => {
  const data = { title: 'hello sirus!' };
  res.render('index', data);
});

const apiRouter = Router().get('/v1', (req, res) => {
  res.status(200).json({
    data: 'hello sirus api!!!',
  });
});

export default [indexRouter, apiRouter, dataRouter];
