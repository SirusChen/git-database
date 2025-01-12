import { Router } from 'express';
import { Database } from '../utils/database';
import axios from 'axios';

const dataRouter = Router();
const db = new Database('xbookmark/xbookmark1');

dataRouter.get('/v1/get', (req, res) => {
  res.status(200).setHeader('Content-Type', 'text/html;charset=utf-8').json({
    data: db.tableFile,
  }).end();
});

// 读取当前整个 bookmark 状态
dataRouter.get('/v1/getDBInfo', async (req, res) => {
  console.log(db.tableFile);
  res.status(200).setHeader('Content-Type', 'text/html;charset=utf-8').json({
    data: db.tableFile,
  }).end();
});

dataRouter.get('/v1/updateDB', async (req, res) => {
  db.updateDB();
  res.end();
});

dataRouter.get('/v1/addFile', async (req, res) => {
  const url = req.query.url as string;
  if (typeof url !== 'string') {
    return res.end();
  }
  console.log('sirus', url);
  // 拉取图片资源
  const resp = await axios({
    method: 'get',
    url,
    responseType: 'arraybuffer' // Important to get the image as a binary buffer
  })
  const base64Image = Buffer.from(resp.data, 'binary').toString('base64');
  db.addFile(base64Image, `${Date.now()}.png`);
  res.end();
});


dataRouter.post('/v1/download', async (req, res) => {
  console.log(req.body);
  res.send().end();
});

export default Router().use('/data', dataRouter);
