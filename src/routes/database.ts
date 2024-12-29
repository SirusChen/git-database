import { Router } from 'express';

const dataRouter = Router();

dataRouter.get('/v1/get', (req, res) => {
  res.status(200).json({
    data: 'dataRouter123',
  }).end();
});

// 读取当前整个 bookmark 状态
dataRouter.get('/v1/load', (req, res) => {
  res.status(200).json({
    data: 'dataRouter123',
  }).end();
});

export default Router().use('/data', dataRouter);

/**
 * 读取数据库内容
 */
function loadDatabaseInfo() {

}