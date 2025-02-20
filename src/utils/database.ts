import axios from "axios"
import { GiteeConfig } from "./database.config"
import FormData from "form-data";
import { Gitee } from "./gitee";

const { owner, repo, access_token, branch } = GiteeConfig;

// interface TableInfo {
//   name: string
//   content: string
//   sha: string
//   /** 文件 raw 地址 */
//   download_url: string
// }

// interface TableFile {
//   updateTime?: number,
//   data: any[];
// }

export class Database {
  tableName: string;
  gitee: Gitee;
  constructor(tableName: string) {
    this.tableName = tableName;
    this.gitee = new Gitee(owner, repo, access_token);
  }
  /**
   * 链接数据库
   * * 建立必要的数据信息
   */
  async connect() {
    const fileList = await this.gitee.getFileList(this.tableName);
    // 验证基础文件是否齐全
    // table 初始化内容 + id 映射内容
    // id 分块信息
  }






  // /** 取文件夹下的文件列表 */
  // /**
  //  * 从完整列表中转存到日期分表
  //  * * 一定要是日期吗 - 不一定，但是最常用的查询条件是时间，因此用时间
  //  * * 用 id 的优势 - 因为 id 是随机的，因此分表的量是随机的，能均匀分表。但是按照顺序查询就比较不方便
  //  */
  // /** 从完整列表中输出主键 Set */
  // /** 取文件夹下的文件列表 */
  // /** 取文件夹下的文件列表 */
  // /** 加载 db info */
  // async getDBInfo() {
  //   const resp = await axios.get(
  //     `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${this.tableName}`,
  //     {
  //       params: {
  //         access_token,
  //       }
  //     }
  //   )
  //   if (resp.status === 200) {
  //     this.tableInfo = resp.data;
  //     if (resp.data.content) {
  //       try {
  //         // git 转码的时候好像用的不是 utf-8 导致 atob 后中文乱码
  //         // this.tableFile = JSON.parse(atob(resp.data.content));
  //       } catch (e) {
  //         console.warn('getDBInfo parse conten error!', e);
  //       }
  //     }
  //   }
  // }
  // /**
  //  * 加载 db raw file
  //  * * 一般只用 getDBInfo 即可
  //  */
  // async getDBFile() {
  //   const resp = await axios.get(
  //     `https://gitee.com/api/v5/repos/${owner}/${repo}/raw/${this.tableName}`,
  //     {
  //       params: {
  //         access_token,
  //       }
  //     }
  //   )
  //   try {
  //     this.tableFile = resp.data;
  //   } catch (e) {
  //     console.warn('getDBFile error!', e);
  //   }
  // }
  // /**
  //  * 更新 table 内容
  //  */
  // async updateDB() {
  //   if (!this.tableInfo?.sha || !this.tableFile) {
  //     console.warn('updateDB error no table info !', this.tableInfo, this.tableFile);
  //     return;
  //   }
  //   this.tableFile.updateTime = Date.now();
  //   const resp = await axios.put(
  //     `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${this.tableName}`,
  //     {
  //       access_token,
  //       content: btoa(JSON.stringify(this.tableFile)),
  //       sha: this.tableInfo.sha,
  //       message: `update in ${new Date()}`,
  //       branch,
  //     }
  //   )
  //   if (resp.status === 200) {
  //     const data = resp.data;
  //     this.tableInfo.sha = data.content.sha;
  //   }
  // }
  // /**
  //  * 新增 item
  //  */
  // async addFile(base64: string, fileName: string) {
  //   const data = new FormData();
  //   data.append('access_token', access_token);
  //   data.append('content', base64);
  //   data.append('message', `add file in ${new Date()}`);

  //   const resp = await axios.post(
  //     `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${fileName}`,
  //     data,
  //     {
  //       headers: data.getHeaders(),
  //     }
  //   );

  //   if ([200, 201].includes(resp.status)) {
  //     //
  //   } else {
  //     console.warn('add file error !', resp.data);
  //   }
  // }
}