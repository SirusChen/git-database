/**
 * Gitee API
 */

import axios, { AxiosRequestConfig } from 'axios';
import FormData from "form-data";
import { GiteeConfig } from './database.config';
import { GiteeFile } from './typing';

export class Gitee {
  private owner: string;
  private repo: string;
  private access_token: string;

  constructor(owner: string, repo: string, access_token: string) {
    this.owner = owner;
    this.repo = repo;
    this.access_token = access_token;
  }

  async request(method: 'get' | 'post' | 'put' | 'delete', url: string, option?: AxiosRequestConfig) {
    const config: AxiosRequestConfig = {
      method,
      url,
      params: {
        access_token: this.access_token,
      },
      ...option,
    }
    const resp = await axios(config);
    if ([200, 201].includes(resp.status)) {
      return resp.data;
    } else {
      console.log('[Gitee] request error', resp);
      return;
    }
  }

  /**
   * 请求文件夹下的文件列表
   * * 同时也可以去 file info
   */
  getFileList(path: string): Promise<GiteeFile[]> {
    return this.request('get', `https://gitee.com/api/v5/repos/${this.owner}/${this.repo}/contents/${path}`);
  }

  /**
   * 查询文件内容
   */
  getFileContent<T = any>(path: string): Promise<T> {
    return this.request('get', `https://gitee.com/api/v5/repos/${this.owner}/${this.repo}/raw/${path}`);
  }

  /**
   * 新增文件
   */
  addFile(filePath: string, base64: string): Promise<{
    content: GiteeFile;
  }> {
    const data = new FormData();
    data.append('access_token', this.access_token);
    data.append('content', base64);
    data.append('message', `add file in ${new Date()}`);
    return this.request(
      'post',
      `https://gitee.com/api/v5/repos/${this.owner}/${this.repo}/contents/${filePath}`,
      {
        data,
        headers: data.getHeaders(),
      }
    )
  }

  /**
   * 更新文件
   */
  updateFile(filePath: string, base64: string, sha: string) {
    const data = new FormData();
    data.append('access_token', this.access_token);
    data.append('content', base64);
    data.append('sha', sha);
    data.append('message', `update file in ${new Date()}`);
    return this.request(
      'put',
      `https://gitee.com/api/v5/repos/${this.owner}/${this.repo}/contents/${filePath}`,
      {
        data,
        headers: data.getHeaders(),
      }
    )
  }
}

async function main() {
  const gitee = new Gitee(
    GiteeConfig.owner,
    GiteeConfig.repo,
    GiteeConfig.access_token,
  );

  // const dataList = await gitee.getFileContent('xbookmark/xbookmark1');
  // for (let i = 0; i < 10; i++) {
  //   const data = dataList[i];
  //   console.log(data.full_text);
  // }

  const data = await gitee.updateFile(
    'W3thOjEyM31d',
    'test-img.png',
    '8a7ce350d751e696becf012889bcfc20d1b2b18f'
  );
  console.log(data);
}

// main().catch(console.error);
