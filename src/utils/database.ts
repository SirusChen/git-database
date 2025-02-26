import axios from "axios"
import { GiteeConfig } from "./database.config"
import FormData from "form-data";
import { Gitee } from "./gitee";
import { BaseData, GiteeFile, TableInfo, TableInfoFileDefaultData, TableInfoFileName, XBookmarkData } from "./typing";

const { owner, repo, access_token, branch } = GiteeConfig;

/**
 * 检查是否有 TableInfoFile
 */
function findTableInfoFile(list: GiteeFile[]) {
  for (let i = 0, len = list.length; i < len; i++) {
    const file = list[i];
    if (file.name === TableInfoFileName) {
      return file;
    }
  }
  return;
}

/**
 * id 换取 key
 */
function getID2Key(id: string, num: number = 1): string {
  return id.slice(-1 * num);
}

/**
 * id 换取 key
 */
function getID2FileName(options: {
  columnKey: string;
  key?: string;
  id?: string;
}): string {
  if (options.key) {
    return `${options.columnKey}-${options.key}`;
  }
  return `${options.columnKey}-${options.id}`;
}

export class Database {
  tableName: string;
  gitee: Gitee;
  tableInfoFile: GiteeFile | undefined;
  tableInfoData: TableInfo['data'] | undefined;
  constructor(tableName: string) {
    this.tableName = tableName;
    this.gitee = new Gitee(owner, repo, access_token);
  }
  /**
   * 链接数据库
   * * 建立必要的数据信息
   */
  async connect() {
    const gitee = this.gitee;
    const fileList = await gitee.getFileList(this.tableName);
    // 验证基础文件是否齐全
    let tableInfoFile = findTableInfoFile(fileList);
    if (!tableInfoFile) {
      // 初始化 table
      tableInfoFile = await this.buildColumnMap('id');
    }
    this.tableInfoFile = tableInfoFile;
    // 加载 TableInfoFile 数据
    this.tableInfoData = await gitee.getFileContent<TableInfo['data']>(
      this.tableInfoFile.path,
    );
  }

  /**
   * 查询 columnKey 对应的数据
   */
  async selectIDColumn(columnKey: string, ids: string | string[]): Promise<BaseData[]> {
    if (!this.tableInfoData) {
      return [];
    }
    if (typeof ids === 'string') {
      ids = [ids];
    }
    const { column2map } = this.tableInfoData;
    for (let i = 0, len = ids.length; i < len; i++) {
      const id = ids[i];
      const key = getID2Key(id);
      column2map[key]
    }
  }

  /**
   * 根据 id 切分数据
   * * 从总文件中分块存储
   * * 从零开始建立 TableInfoFile
   */
  async buildColumnMap(columnKey: 'id') {
    const gitee = this.gitee;
    // 1. 取出所有数据
    const dataList = await gitee.getFileContent<XBookmarkData[]>('xbookmark/xbookmark1');
    // 2. 根据 columnKey 分块
    const column2map: Record<string, XBookmarkData[]> = {}
    for (let i = 0, len = dataList.length; i < len; i++) {
      const data = dataList[i];
      const key = getID2Key(data[columnKey]);
      if (!column2map[key]) {
        column2map[key] = [data];
      } else {
        column2map[key].push(data);
      }
    }
    // 3. 保存 columnKey 文件
    const fileMap: Record<string, GiteeFile> = {};
    const _column2map: {
      [column: string]: BaseData[];
    } = {};
    for (const [key, list] of Object.entries(column2map)) {
      const fileName = getID2FileName({
        columnKey,
        key,
      });
      const { content } = await gitee.addFile(
        `${this.tableName}/${fileName}`,
        Buffer.from(JSON.stringify(list)).toString('base64')
      );
      fileMap[fileName] = {
        ...content,
        // data: list
      };
      _column2map[fileName] = list.map<BaseData>(item => {
        return { id: item.id }
      });
    }
    // 4. 保存 TableInfoFile
    const TableInfoFile: TableInfo['data'] = {
      ...TableInfoFileDefaultData,
      column2map: _column2map,
    }
    const { content } = await gitee.addFile(
      `${this.tableName}/${TableInfoFileName}`,
      Buffer.from(JSON.stringify(TableInfoFile)).toString('base64')
    );
    return {
      ...content,
      data: TableInfoFile
    };
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

async function main() {
  const database = new Database('xbookmark');
  // await database.buildColumnMap('id');
  await database.connect();
  console.log(database.tableInfoData);
}

main().catch(error => {
  console.error('Error in main:', error);
});
