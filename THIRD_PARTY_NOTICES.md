# 第三方组件与数据

本项目原创代码采用 MIT；第三方组件和数据依各自许可使用。

- `src/domain.ts` 的 `routeGeometry` 改编自 Eigenoperator/flight-atlas 的 `makeRouteGeometry`（提交 `2cc4080d557b67e4af854e5813fd56c6d4bc04e8`）；原始 MIT 文本保留在 `licenses/flight-atlas-MIT.txt`。其他功能独立实现。
- React / React DOM、FastAPI / Starlette / Pydantic / Uvicorn：MIT。D3 Geo / D3 Array / InternMap、Lucide React：ISC。tzdata 使用 IANA 数据与包自身许可。锁定版本见 `package-lock.json` 和 `requirements.txt`，许可文本见安装包及 `licenses/`。
- [OurAirports](https://ourairports.com/data/)：Public Domain，机场信息不保证准确。本项目保存有 IATA 的非关闭机场及本地中文显示别名。
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)：Public Domain，仅采用物理陆地／海岸线，不将其作为行政国界。下载记录见 `audit/data-sources.json`。
- 中国国界／轮廓与省界：支持[天地图官方行政区划可视化入口](https://cloudcenter.tianditu.gov.cn/administrativeDivision)导出的中国省级 GeoJSON，主办自然资源部、承办国家基础地理信息中心。官方标注“该数据仅供地图可视化使用”。原始及衍生 GeoJSON **不随仓库分发**，请使用者自行从官方入口获取、遵守使用条件并通过 `prepare_boundaries.py` 本地生成。该数据不属于本项目 MIT 许可。截图中的演示地图使用这一来源；官方网页预览审图号不作为本应用审图号。

截图和演示航班均为虚构数据，不包含个人原始行程、登机牌或乘客信息。未复制航旅纵横的图标、商标或受保护界面素材。
