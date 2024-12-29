import path from 'path';
import express from 'express';
import routes from './routes';

const app = express();
const port = process.env.PORT || 3001;

app.set('views', path.resolve('src', 'views'));
app.set('view engine', 'ejs');

routes.forEach((route) => {
  app.use('/', route);
})

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;


// import axios from 'axios';
// import FormData from 'form-data';

// axios({
//   method: 'get',
//   url: 'https://pbs.twimg.com/media/Gf4xtIfaoAEw2qJ?format=jpg&name=large',
//   responseType: 'arraybuffer' // Important to get the image as a binary buffer
// }).then((response) => {
//   // Convert the Buffer to a Base64 string
//   const base64Image = Buffer.from(response.data, 'binary').toString('base64');

//   const data = new FormData();
//   data.append('access_token', 'c29c8cb5a321412714dab715abee001');
//   data.append('content', base64Image);
//   data.append('message', 'test create');

//   const config = {
//     method: 'post',
//     url: 'https://gitee.com/api/v5/repos/siruschen/git-database/contents/test-0011.gif',
//     headers: {
//         ...data.getHeaders()
//     },
//     data : data
//   };

//   axios(config)
//   .then(function (response) {
//     console.log(JSON.stringify(response.data));
//   })
//   .catch(function (error) {
//     console.log(error);
//   });
// }).catch((error) => {
//   console.error(error);
// });