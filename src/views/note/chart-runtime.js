// 独立异步 chunk，仅可见图表加载；SVG 无持续动画循环。
import { init, use } from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, FunnelChart, RadarChart, BoxplotChart, CustomChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, RadarComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

use([BarChart, LineChart, PieChart, ScatterChart, FunnelChart, RadarChart, BoxplotChart, CustomChart, GridComponent, TooltipComponent, LegendComponent, RadarComponent, SVGRenderer])
export { init }
