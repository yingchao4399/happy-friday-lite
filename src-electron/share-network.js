import os from 'node:os'

// 优先使用可供同一局域网设备访问的实体网卡；仍保留其他网卡供用户选择。
export function shareNetworkAddresses(interfaces = os.networkInterfaces()) {
  const entries = []
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const iface of addresses || []) {
      if (!['IPv4', 4].includes(iface.family) || iface.internal || !/^\d+\.\d+\.\d+\.\d+$/.test(iface.address)) continue
      const address = iface.address
      const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
      const virtual = /vpn|tun|tap|clash|tailscale|zerotier|wireguard|virtual|vmware|vbox|docker|wsl|vethernet|vgate|loopback/i.test(name)
      const score = (/^169\.254\./.test(address) ? 10 : 0) + (virtual ? 4 : 0) + (privateAddress ? 0 : 2)
      entries.push({ address, label: name + ' · ' + address, score })
    }
  }
  const unique = [...new Map(entries.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)).map(entry => [entry.address, entry])).values()]
  return unique.length ? unique.map(({ score, ...entry }) => entry) : [{ address: '127.0.0.1', label: '127.0.0.1' }]
}
