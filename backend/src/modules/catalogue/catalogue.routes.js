const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
const { listItems, createItem, updateItem, deleteItem } = require('./catalogue.controller')

const router = express.Router()
router.use(requireAuth)

router.get('/', listItems)
router.post('/', createItem)
router.put('/:id', updateItem)
router.delete('/:id', deleteItem)

module.exports = router
