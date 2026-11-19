use super::*;
impl Library {
    pub fn uninstall_plugin(&mut self,id:&str)->Result<()> {
        let plugin=self.plugins()?.into_iter().find(|p|p.manifest["id"]==id).ok_or_else(||AppError::new("PLUGIN","插件未安装"))?;
        let directory=self.data_dir.join("plugins").join(plugin.manifest["id"].as_str().ok_or_else(||AppError::new("PLUGIN","插件 ID 无效"))?);
        let actual=directory.canonicalize()?;if !actual.starts_with(self.data_dir.join("plugins").canonicalize()?){return Err(AppError::new("PATH","插件路径无效"));}fs::remove_dir_all(actual)?;
        if let Some(workspaces)=self.persisted.settings["plugins"].as_object_mut(){for settings in workspaces.values_mut(){if let Some(settings)=settings.as_object_mut(){settings.remove(id);}}}self.persist()
    }
    pub fn plugin_request(&self,workspace:&str,plugin_id:&str,method:&str,path:&str,text:&str)->Result<serde_json::Value>{
        let config=&self.persisted.settings["plugins"][workspace][plugin_id];
        if self.persisted.settings["safeMode"]==true||config["enabled"]!=true{return Err(AppError::new("PERMISSION","插件已停用或安全模式已启用"));}
        self.plugins()?.into_iter().find(|p|p.manifest["id"]==plugin_id).ok_or_else(||AppError::new("PLUGIN","插件未安装"))?;
        let permission=if method=="write"||method=="create"||method=="delete"{"files:write"}else{"files:read"};
        if !config["permissions"].as_array().is_some_and(|a|a.iter().any(|p|p==permission)){return Err(AppError::new("PERMISSION","插件未获得此文件权限"));}
        match method {
            "read"=>Ok(serde_json::to_value(self.read(workspace,path)?).map_err(|_|AppError::new("PLUGIN","文件结果无效"))?),
            "list"=>Ok(serde_json::to_value(self.list(workspace,path,false)?).map_err(|_|AppError::new("PLUGIN","目录结果无效"))?),
            "write"=>{let file=match self.read(workspace,path){Ok(doc)=>doc,Err(e) if e.code=="NOT_FOUND"=>{self.create(workspace,path,false)?;self.read(workspace,path)?},Err(e)=>return Err(e)};let updated=self.write(workspace,path,text,&file.version,&file.encoding)?;serde_json::to_value(updated).map_err(|_|AppError::new("PLUGIN","写入结果无效"))},
            _=>Err(AppError::new("PLUGIN","插件操作不支持")),
        }
    }
}
pub fn download(url:&str,limit:usize)->Result<Vec<u8>>{
    let url=tauri::Url::parse(url).map_err(|_|AppError::new("NETWORK","网址无效"))?;
    if url.scheme()!="https"||!url.username().is_empty()||url.password().is_some(){return Err(AppError::new("NETWORK","仅支持 HTTPS 服务"));}
    let client=reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|AppError::new("NETWORK","连接初始化失败"))?;
    let response=client.get(url.as_str()).send().and_then(|r|r.error_for_status()).map_err(|_|AppError::new("NETWORK","无法读取远程服务"))?;
    if response.content_length().is_some_and(|size|size>limit as u64){return Err(AppError::new("NETWORK","下载内容过大"));}
    use std::io::Read;let mut bytes=Vec::new();response.take(limit as u64+1).read_to_end(&mut bytes)?;if bytes.len()>limit{return Err(AppError::new("NETWORK","下载内容过大"));}Ok(bytes)
}
pub fn repository(url:&str)->Result<serde_json::Value>{let bytes=download(url,2*1024*1024)?;let value:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|AppError::new("PLUGIN","仓库索引无效"))?;if !value["plugins"].is_array(){return Err(AppError::new("PLUGIN","仓库需要 plugins 清单"));}Ok(value)}
impl Library {
    pub fn install_remote_plugin(&self,url:&str,digest:&str)->Result<PluginBundle>{
        if digest.len()!=64||!digest.chars().all(|c|c.is_ascii_hexdigit()){return Err(AppError::new("PLUGIN","仓库必须提供 SHA-256 校验值"));}
        let bytes=download(url,8*1024*1024)?;if !version(&bytes).eq_ignore_ascii_case(digest){return Err(AppError::new("PLUGIN","插件下载校验失败"));}
        let bundle:PluginBundle=serde_json::from_slice(&bytes).map_err(|_|AppError::new("PLUGIN","插件包需要 manifest/source/styles JSON 格式"))?;
        let temp=tempfile::tempdir()?;fs::write(temp.path().join("manifest.json"),serde_json::to_vec(&bundle.manifest).map_err(|_|AppError::new("PLUGIN","插件清单无效"))?)?;fs::write(temp.path().join("main.js"),bundle.source)?;fs::write(temp.path().join("styles.css"),bundle.styles)?;self.install_plugin(temp.path())
    }
}
