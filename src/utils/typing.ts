export interface GiteeFile<T = any> {
  name: string;
  path: string;
  sha: string;
  content?: string;
  data?: T
}

interface ColumnInfo {
  key: string;
  /**
   * 是否建立了文件列表
   * * 是 - 直接到对应文件取数
   * * 否 - 到 id 字段取数
   */
  hasFiles: boolean;
}


export interface TableInfo extends GiteeFile {
  data: {
    /** 一对一映射的字段 */
    idColumns: ColumnInfo[];
    /** 有顺序关系的字段 */
    numColumns: ColumnInfo[];
    /**
     * 对上述列的映射
     * columnKey - key - id list
     */
    column2map: {
      [columnKey: string]: Record<string, string[]>;
    }
  }
}

enum MediaSizeKey {
  large = 'large',
  medium = 'medium',
  small = 'small',
  thumb = 'thumb',
}

export interface BaseData {
  // id 是必须的
  id: string;
}

export interface XBookmarkData extends BaseData {
  id: string;
  full_text: string;
  created_at: string;
  user: {
    name: string;
    screen_name: string;
    profile_banner_url: string;
    profile_image_url_https: string;
  }
  media: {
    url: string;
    type: 'photo' | 'video';
    media_url_https: string;
    size: Record<MediaSizeKey, {
        w: number;
        h: number;
        resize: string;
    }>
  }[]
}

export const TableInfoFileName = 'table_info';

export const TableInfoFileDefaultData: TableInfo['data'] = {
  idColumns: [
    {
      key: 'id',
      hasFiles: true,
    },
  ],
  numColumns: [],
  column2map: {},
}