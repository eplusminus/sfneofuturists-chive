'use strict'

const fs = require('fs')
const path = require('path')

const express = require('express')
const moment = require('moment')

const {getTree, getMeta} = require('./list')
const {fetchDoc, cleanName} = require('./docs')

const availableLayouts = (fs.readdirSync(path.join(__dirname, 'layouts')) || [])
  .reduce((memo, filename) => {
    const [name] = filename.split('.')
    memo.add(name)
    return memo
  }, new Set())

const app = express()
app.set('view engine', 'ejs')
app.set('views', './layouts')

app.get('/healthcheck', (req, res) => {
  res.send('OK')
})

app.get('*', (req, res) => {
  console.log(`GET ${req.path}`)
  const segments = req.path.split('/')

  // don't allow viewing index directly
  if (segments.slice(-1)[0] === 'index') {
    return res.redirect(301, segments.slice(0, -1).join('/'))
  }

  // get an up to date doc tree
  getTree((err, tree) => {
    if (err) {
      return res.status(500).send(err)
    }

    const [data, parent] = retrieveDataForPath(req.path, tree)
    const {id, breadcrumb, nodeType} = data
    if (!id) {
      return res.status(404).end('Not found.')
    }

    const root = segments[1]
    const meta = getMeta(id)
    const layout = availableLayouts.has(root) ? root : 'default'

    // don't try to fetch branch node
    if (nodeType === 'branch') {
      return res.status(404).send('Can\'t render contents of a folder yet.')
    }

    // also catch empty folders
    if (meta.mimeType.split('.').pop() === 'folder') {
      return res.status(404).send('It looks like this folder is empty...')
    }

    fetchDoc(data.id, (err, {html, originalRevision, sections} = {}) => {
      if (err) {
        return res.status(500).send(err)
      }

      const contextData = prepareContextualData(req.path, breadcrumb, parent, meta.slug)
      res.render(layout, Object.assign({}, contextData, {
        url: req.path,
        content: html,
        title: meta.prettyName,
        lastUpdatedBy: meta.lastModifyingUser.displayName,
        lastUpdated: moment(meta.modifiedTime).fromNow(), // determine some sort of date here
        createdAt: moment(meta.createdTime).fromNow(), // we won't be able to tell this
        createdBy: originalRevision.lastModifyingUser.displayName,
        editLink: meta.webViewLink,
        sections
      }))
    })
  })
})

app.listen(3000)

function retrieveDataForPath(path, tree) {
  const segments = path.split('/').slice(1).filter((s) => s.length)

  let pointer = tree
  let parent = null
  // continue traversing down the tree while there are still segements to go
  while ((pointer || {}).nodeType === 'branch' && segments.length) {
    parent = pointer
    pointer = pointer.children[segments.shift()]
  }

  // if we used up segments and are looking at a folder, try index
  if ((pointer || {}).nodeType === 'branch' && pointer.children.index) {
    parent = pointer
    pointer = pointer.children.index
  }

  // return the leaf and its immediate branch
  return [pointer || {}, parent]
}

function prepareContextualData(url, breadcrumb, parent, slug) {
  const breadcrumbInfo = breadcrumb.map(({id}) => getMeta(id))

  const self = slug === 'index' ? 'index' : url.split('/').slice(-1)[0]
  // most of what we are doing here is preparing parents and siblings
  // we need the url and parent object, as well as the breadcrumb to do that
  const siblings = Object.keys(parent.children)
    .filter((slug) => slug !== self && slug !== 'index')
    .map((slug) => {
      const {id} = parent.children[slug] // we should do something here
      const {sort, prettyName, webViewLink} = getMeta(id)

      // on an index page, the base url is the current url
      // for other pages, remove the slug from that url
      const baseUrl = self === 'index' ? url : `${url.split('/').slice(0, -1).join('/')}`
      return {
        sort,
        name: prettyName,
        editLink: webViewLink,
        url: path.join(baseUrl, slug)
      }
    })
    .sort((a, b) => a.sort > b.sort)

  const parentLinks = url
    .split('/')
    .slice(1, -1) // ignore the base empty string and self
    .map((segment, i, arr) => {
      return {
        url: `/${arr.slice(0, i + 1).join('/')}`,
        name: cleanName(breadcrumbInfo[i].name),
        editLink: breadcrumbInfo[i].webViewLink
      }
    })

  return {
    parentLinks,
    siblings
  }
}
