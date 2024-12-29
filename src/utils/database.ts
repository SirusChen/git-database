import axios from "axios"
import { GiteeConfig } from "./database.config"
import FormData from "form-data";

const { owner, repo, access_token, branch } = GiteeConfig;

interface TableInfo {
  name: string
  content: string
  sha: string
  /** 文件 raw 地址 */
  download_url: string
}

interface TableFile {
  updateTime?: number,
  data: any[];
}

export class Database {
  tableName: string
  tableInfo: TableInfo | undefined
  tableFile: TableFile | undefined
  constructor(tableName: string) {
    this.tableName = tableName
    // this.getDBInfo();
  }
  /** 加载 db info */
  async getDBInfo() {
    const resp = await axios.get(
      `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${this.tableName}`,
      {
        params: {
          access_token,
        }
      }
    )
    if (resp.status === 200) {
      this.tableInfo = resp.data;
      if (resp.data.content) {
        try {
          this.tableFile = JSON.parse(atob(resp.data.content));
        } catch (e) {
          console.warn('getDBInfo parse conten error!', e);
        }
      }
    }
  }
  /**
   * 加载 db raw file
   * * 一般只用 getDBInfo 即可
   */
  async getDBFile() {
    const resp = await axios.get(
      `https://gitee.com/api/v5/repos/${owner}/${repo}/raw/${this.tableName}`,
      {
        params: {
          access_token,
        }
      }
    )
    try {
      this.tableFile = resp.data;
    } catch (e) {
      console.warn('getDBFile error!', e);
    }
  }
  /**
   * 更新 table 内容
   */
  async updateDB() {
    if (!this.tableInfo?.sha || !this.tableFile) {
      console.warn('updateDB error no table info !', this.tableInfo, this.tableFile);
      return;
    }
    this.tableFile.updateTime = Date.now();
    const resp = await axios.put(
      `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${this.tableName}`,
      {
        access_token,
        content: btoa(JSON.stringify(this.tableFile)),
        sha: this.tableInfo.sha,
        message: `update in ${new Date()}`,
        branch,
      }
    )
    if (resp.status === 200) {
      const data = resp.data;
      this.tableInfo.sha = data.content.sha;
    }
  }
  /**
   * 新增 item
   */
  async addFile(base64: string, fileName: string) {
    const data = new FormData();
    data.append('access_token', access_token);
    data.append('content', base64);
    data.append('message', `add file in ${new Date()}`);

    const resp = await axios.post(
      `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${fileName}`,
      data,
      {
        headers: data.getHeaders(),
      }
    );

    if ([200, 201].includes(resp.status)) {
      //
    } else {
      console.warn('add file error !', resp.data);
    }
  }
}