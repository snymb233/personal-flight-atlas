async(page)=>{
  const base='http://127.0.0.1:8772';
  const world=await (await page.request.get(base+'/_test-world.json')).json();
  const china=await (await page.request.get(base+'/_test-china.json')).json();
  const check=(value,message)=>{if(!value)throw Error(message);};
  const context=await page.context().browser().newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  let fixture=world;const errors=[];let writes=0;
  await context.addInitScript(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files?.length===1});
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.__nativeShareCheck={name:files[0].name,type:files[0].type,size:files[0].size};}});
  });
  await context.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET')writes++;
    const payload=path==='/api/health'?{name:'Personal Flight Atlas',mode:'cloud'}:path==='/api/auth/me'?{user:null,mode:'cloud'}:path==='/api/demo'?fixture:{detail:'Read-only browser fixture'};
    return route.fulfill({status:['/api/health','/api/auth/me','/api/demo'].includes(path)?200:403,contentType:'application/json',body:JSON.stringify(payload)});
  });
  const ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));
  await ui.goto(base);await ui.getByRole('button',{name:'先浏览演示',exact:true}).click();
  await ui.locator('.flight-map[data-map-mode=world]').waitFor();await ui.locator('.official-china-layer').first().waitFor();
  check(await ui.locator('.airport-dot').count()===11,'Worldwide airport count');
  const routes=ui.locator('section.ranking').filter({has:ui.getByRole('heading',{name:'最常飞航线',exact:true})});
  const routeText=await routes.innerText();check(routeText.includes('Paris')||routeText.includes('巴黎'),'Route ranking must contain city names');
  const airportRanking=ui.locator('section.ranking').filter({has:ui.getByRole('heading',{name:'最常出发机场',exact:true})});
  check((await airportRanking.innerText()).includes('机场')||(await airportRanking.innerText()).includes('Airport'),'Airport ranking must contain airport names');
  await ui.screenshot({path:'output/playwright/world-dashboard.png'});
  await ui.getByRole('button',{name:'切换到中国地图',exact:true}).click();await ui.locator('.flight-map[data-map-mode=china]').waitFor();
  await ui.getByRole('button',{name:'重置地图',exact:true}).click();await ui.locator('.flight-map[data-map-mode=world]').waitFor();
  await ui.getByRole('button',{name:'切换到世界地图',exact:true}).click();await ui.locator('.flight-map[data-map-mode=world]').waitFor();
  await ui.getByRole('button',{name:'航线地图',exact:true}).click();await ui.locator('.flight-map[data-map-mode=world]').waitFor();
  await ui.getByRole('button',{name:'分享足迹',exact:true}).click();await ui.locator('.share-preview').waitFor({timeout:60000});
  const downloading=ui.waitForEvent('download');await ui.getByRole('link',{name:'保存 PNG 图片',exact:true}).click();const download=await downloading;await download.saveAs('output/playwright/world-share.png');
  const dimensions=await ui.locator('.share-preview').evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight}));check(dimensions.width===1080&&dimensions.height>=1620,'PNG dimensions');
  await ui.getByRole('button',{name:'系统分享',exact:true}).click();const shared=await ui.evaluate(()=>window.__nativeShareCheck);check(shared?.type==='image/png'&&shared.size>10000,'Native share file handoff');
  await ui.getByRole('button',{name:'关闭分享',exact:true}).click();await ui.getByRole('dialog').waitFor({state:'hidden'});
  await ui.getByRole('button',{name:'年度报告',exact:true}).click();await ui.locator('.annual-report .flight-map[data-map-mode=world]').waitFor();await ui.locator('.official-china-layer').first().waitFor();
  check((await ui.locator('.report-ranks').innerText()).includes('机场')||(await ui.locator('.report-ranks').innerText()).includes('Airport'),'Report airport names');
  await ui.setViewportSize({width:390,height:844});check(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile report overflow');
  await ui.getByRole('button',{name:'分享足迹',exact:true}).click();await ui.locator('.share-preview').waitFor();check(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile sharing overflow');
  await ui.screenshot({path:'output/playwright/world-share-mobile.png'});await ui.getByRole('button',{name:'关闭分享',exact:true}).click();
  fixture=china;await ui.goto(base);await ui.getByRole('button',{name:'先浏览演示',exact:true}).click();await ui.locator('.flight-map[data-map-mode=china]').waitFor();
  await ui.getByRole('button',{name:'分享足迹',exact:true}).click();await ui.locator('.share-preview').waitFor();const domesticDownload=ui.waitForEvent('download');await ui.getByRole('link',{name:'保存 PNG 图片',exact:true}).click();await (await domesticDownload).saveAs('output/playwright/china-share.png');
  check(writes===0,'Sharing must not write flights or upload images');check(errors.length===0,'Browser errors: '+errors.join(';'));
  await page.evaluate(value=>window.__sharingCheck=value,{passed:true,worldMap:true,internationalRoutes:true,namedRankings:true,worldPng:true,singleCountryPng:true,mobile:true,nativeShareMock:true,serverWrites:writes,errors});
  await context.close();
}
