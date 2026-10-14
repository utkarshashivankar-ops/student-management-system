const mongoose = require('mongoose');
const Student = require('../models/Student');

// Fields that clients are allowed to send
const FIELDS = ['studentId', 'name', 'email', 'department', 'semester', 'contact'];

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => {
    if (body && body[f] !== undefined) out[f] = body[f];
  });
  return out;
};

// :id may be the human-readable studentId (e.g. ST101) or the MongoDB _id
const buildIdFilter = (id) => {
  const clauses = [{ studentId: String(id).trim().toUpperCase() }];
  if (mongoose.isValidObjectId(id)) clauses.push({ _id: id });
  return { $or: clauses };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/students            -> all students
// GET /api/students?search=abc -> filter by id, name, email or department
exports.getStudents = async (req, res, next) => {
  try {
    const filter = {};
    const term = (req.query.search || '').toString().trim();
    if (term) {
      const rx = new RegExp(escapeRegex(term.slice(0, 60)), 'i');
      filter.$or = [{ studentId: rx }, { name: rx }, { email: rx }, { department: rx }];
    }
    const students = await Student.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: students.length, data: students });
  } catch (err) {
    next(err);
  }
};

// GET /api/students/:id
exports.getStudent = async (req, res, next) => {
  try {
    const student = await Student.findOne(buildIdFilter(req.params.id));
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, data: student });
  } catch (err) {
    next(err);
  }
};

// POST /api/students
exports.createStudent = async (req, res, next) => {
  try {
    const student = await Student.create(pick(req.body, FIELDS));
    res.status(201).json({ success: true, message: 'Student added successfully', data: student });
  } catch (err) {
    next(err);
  }
};

// PUT /api/students/:id   (studentId itself cannot be changed)
exports.updateStudent = async (req, res, next) => {
  try {
    const updates = pick(req.body, FIELDS.filter((f) => f !== 'studentId'));
    const student = await Student.findOneAndUpdate(buildIdFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, message: 'Student updated successfully', data: student });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/students/:id
exports.deleteStudent = async (req, res, next) => {
  try {
    const student = await Student.findOneAndDelete(buildIdFilter(req.params.id));
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, message: 'Student deleted successfully' });
  } catch (err) {
    next(err);
  }
};
