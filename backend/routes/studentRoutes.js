const express = require('express');
const c = require('../controllers/studentController');

const router = express.Router();

router.route('/').get(c.getStudents).post(c.createStudent);
router.route('/:id').get(c.getStudent).put(c.updateStudent).delete(c.deleteStudent);

module.exports = router;
