require('dotenv').config()

const got = require('got')
const fs = require('fs')
const path = require('path')

const SAVE_UPLOADS = 1

const api = got.extend({
  prefixUrl: process.env.RCTF_API,
  responseType: 'json',
  resolveBodyOnly: true,
  headers: {
    'Authorization': `Bearer ${process.env.RCTF_TOKEN}`,
  },
})

const mkdirp = p => fs.promises.mkdir(p, { recursive: true })
const save = async (p, j) => {
  await mkdirp(path.dirname(p))
  return fs.promises.writeFile(p, JSON.stringify(j))
}
const load = async p => JSON.parse(await fs.promises.readFile(p, { encoding: 'utf-8' }))

const download = async (url, pathname) => {
  const fullPath = path.join(__dirname, pathname)
  if (fs.existsSync(fullPath)) {
    return
  }
  await mkdirp(path.dirname(fullPath))
  const content = got.stream(url)
  const writer = fs.createWriteStream(fullPath)
  content.pipe(writer)
  return new Promise((resolve, reject) => {
    content.on('finish', resolve)
    content.on('error', reject)
  })
}

const saveChalls = async () => {
  const fn = 'json/challs.json'
  if (fs.existsSync(fn)) {
    return load(fn)
  }
  const challs = await api('challs')
  if (SAVE_UPLOADS) {
    for (const chall of challs.data) {
      for (const file of chall.files) {
        const url = file.url
        const pathname = (new URL(url)).toString().split('key=')[1]
        console.log(`Downloading ${url} to ${pathname}`)
        await download(url, pathname)
        file.url = pathname
      }
    }
  }
  await save(fn, challs)
  return challs
}

const saveLeaderboard = async division => {
  const fn = `json/leaderboard/${division}`
  if (fs.existsSync(fn)) {
    return
  }
  let total = 1
  const searchParams = {
    limit: 100,
    offset: 0,
  }
  if (division !== 'all') {
    searchParams.division = division
  }
  while (searchParams.offset <= total) {
    const now = await api('leaderboard/now', { searchParams })
    total = now.data.total
    await save(`${fn}/now-${searchParams.offset}.json`, now)
    searchParams.offset += searchParams.limit
  }

  delete searchParams.offset
  searchParams.limit = 10
  const graph = await api('leaderboard/graph', { searchParams })
  await save(`${fn}/graph.json`, graph)
}

const saveProfile = async (id) => {
  const fn = `json/users/${id}.json`
  if (fs.existsSync(fn)) {
    return load(fn)
  }
  const user = await api(`users/${id}`)
  await save(fn, user)
  return user
}

const saveSolves = async ({ id, solves }) => {
  const fn = `json/solves/${id}`
  if (fs.existsSync(fn)) {
    return
  }
  const searchParams = {
    limit: 10,
    offset: 0,
  }
  while (searchParams.offset <= solves) {
    const solves = await api(`challs/${id}/solves`, { searchParams })
    await save(`${fn}/${searchParams.offset}.json`, solves)
    searchParams.offset += searchParams.limit
  }
}

const getDivisions = async () => {
  const config = await api(`integrations/client/config`)
  return Object.keys(config.data.divisions)
}

const getUsers = async () => {
  const fn = 'users.json'
  if (fs.existsSync(fn)) {
    return load(fn)
  }
  const rv = []
  for (let i = 0, p; (p = `json/leaderboard/all/now-${i}.json`) && fs.existsSync(p); i += 100) {
    const page = await load(p)
    rv.push(...page.data.leaderboard.map(e => e.id))
  }
  await save(fn, rv)
  return rv
}

;(async () => {
  const challs = await saveChalls()
  await Promise.all(challs.data.map(saveSolves))

  await saveLeaderboard('all')
  const divisions = await getDivisions()
  await Promise.all(divisions.map(saveLeaderboard))

  const users = await getUsers()
  await Promise.all(users.map(saveProfile))
})()
